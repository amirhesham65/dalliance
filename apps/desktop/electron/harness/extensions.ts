import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import { type ConcernKind, inspectCode, isSecretPath } from './code-policy'
import type { EventBus, HarnessEvent } from './events'

export { isSecretPath }

/** Keeps .env files private: read_file refuses them, and the reason goes back to the model. */
export function blockSecretFiles(bus: EventBus) {
  bus.on('tool_call', ({ toolName, input }) => {
    const p = String((input as { path?: string } | undefined)?.path ?? '')
    if (toolName === 'read_file' && isSecretPath(p)) return { block: true, reason: `${p} may hold secrets, so it is off limits.` }
  })
}

const ASK: Record<Exclude<ConcernKind, 'secret'>, { title: string; declined: string }> = {
  shell: {
    title: 'Let the agent run shell commands?',
    declined: 'the user declined letting the code run shell commands, subprocesses or pip. Install packages with install_packages, do the rest in plain Python, or explain in finish why you can\'t.',
  },
  network: {
    title: 'Let the agent use the network?',
    declined: "the user declined letting the code use the network. Work with the data in the notebook's folder, or explain in finish why you can't.",
  },
}

/** One line of code for an approval prompt or a block reason. */
const short = (line: string) => (line.length > 120 ? `${line.slice(0, 119)}…` : line)

/**
 * Reads the Python that explore and run_cell are about to run. Secret files and the keychain are blocked outright.
 * Shell commands and the network go through the same approval policy as package installs: never asked in
 * background mode, asked once per session in interactive mode, and skipped for trusted keys in delegated mode.
 */
export function codePolicy(bus: EventBus) {
  bus.on('tool_call', async ({ toolName, input, approve }) => {
    if (toolName !== 'explore' && toolName !== 'run_cell') return
    const concerns = inspectCode(String((input as { code?: unknown } | undefined)?.code ?? ''))
    const secret = concerns.find((c) => c.kind === 'secret')
    if (secret) {
      return {
        block: true,
        reason: `the code ${secret.what} (\`${short(secret.line)}\`), which may hold secrets, so it is off limits. Do the task without it. If the user needs that step, say in finish that they can write it into the cell themselves.`,
      }
    }
    for (const kind of ['shell', 'network'] as const) {
      const hit = concerns.find((c) => c.kind === kind)
      if (!hit) continue
      // Outside a run there is nobody to ask, so the answer is no
      const allowed = approve ? await approve({ title: ASK[kind].title, detail: short(hit.line), keys: [`code:${kind}`] }) : false
      if (!allowed) return { block: true, reason: ASK[kind].declined }
    }
  })
}

export const LOGGED_EVENTS: readonly HarnessEvent[] = ['run_start', 'tool_call', 'tool_result', 'step', 'run_end']
/** agent.jsonl moves to agent.jsonl.1 once the next line would take it past this. */
export const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_LOG_STRING = 2000

export interface RunLog {
  readonly file: string
  /** Queues one line. Resolves once it and every line before it are written, or have failed. */
  write(event: string, data: object): Promise<void>
  /** Resolves once every line queued so far is written. */
  idle(): Promise<void>
}

/**
 * A JSONL log that writes one line at a time, in the order write() was called, and rotates at maxBytes
 * keeping one backup. A failed write drops that line and never stops the ones after it.
 */
export function createRunLog(logDir: string, options: { maxBytes?: number } = {}): RunLog {
  const maxBytes = options.maxBytes ?? MAX_LOG_BYTES
  const file = path.join(logDir, 'agent.jsonl')
  // Known after the first write, so rotation doesn't stat the file for every line
  let size: number | null = null
  let queue: Promise<void> = Promise.resolve()

  const append = async (line: string) => {
    if (size == null) {
      await mkdir(logDir, { recursive: true })
      size = await stat(file).then(
        (s) => s.size,
        () => 0,
      )
    }
    const bytes = Buffer.byteLength(line)
    if (size > 0 && size + bytes > maxBytes) {
      await rename(file, `${file}.1`)
      size = 0
    }
    await appendFile(file, line)
    size += bytes
  }

  return {
    file,
    write(event, data) {
      // Serialized now, so the timestamp and the data are those of the moment the event happened
      // Reasoning summaries stay whole: they're the record of why a cell was made, see docs/agent-harness.md
      const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...data }, (k, v) => (k !== 'reasoning' && typeof v === 'string' && v.length > MAX_LOG_STRING ? `${v.slice(0, MAX_LOG_STRING)}…` : v))}\n`
      queue = queue
        .then(() => append(line))
        .catch(() => {
          // Look at the file afresh next time, in case it was moved or deleted
          size = null
        })
      return queue
    },
    idle: () => queue,
  }
}

/** Appends every event to logs/agent.jsonl, with long strings clipped. Never holds up the run. */
export function logRuns(bus: EventBus, log: RunLog) {
  for (const event of LOGGED_EVENTS) {
    bus.on(event, (data) => {
      void log.write(event, data)
    })
  }
}

/**
 * The built-in extensions. `logDir` is where agent.jsonl goes. The log goes first so it sees every call,
 * including the ones a later handler blocks.
 */
export function installExtensions(bus: EventBus, options: { logDir: string; maxLogBytes?: number }): { log: RunLog } {
  const log = createRunLog(options.logDir, { maxBytes: options.maxLogBytes })
  logRuns(bus, log)
  blockSecretFiles(bus)
  codePolicy(bus)
  return { log }
}
