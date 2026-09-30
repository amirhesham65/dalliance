import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { EventBus } from './events'

/** A read_file path the agent may not open: `.env` or `.env.*`, in any case, with either kind of separator. */
export function isSecretPath(p: string): boolean {
  const base = p.split(/[\\/]/).pop() ?? ''
  return /^\.env(\..*)?$/i.test(base)
}

/** Keeps .env files private: read_file refuses them, and the reason goes back to the model. */
export function blockSecretFiles(bus: EventBus) {
  bus.on('tool_call', ({ toolName, input }) => {
    const p = String((input as { path?: string } | undefined)?.path ?? '')
    if (toolName === 'read_file' && isSecretPath(p)) return { block: true, reason: `${p} may hold secrets, so it is off limits.` }
  })
}

/** Appends every event to logs/agent.jsonl, with long strings clipped. */
export function logRuns(bus: EventBus, logDir: string) {
  const log = async (event: string, data: object) => {
    await mkdir(logDir, { recursive: true })
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...data }, (_k, v) => (typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v))
    await appendFile(path.join(logDir, 'agent.jsonl'), `${line}\n`)
  }
  for (const event of ['run_start', 'tool_call', 'tool_result', 'run_end'] as const) {
    bus.on(event, (data) => {
      void log(event, data).catch(() => {})
    })
  }
}

/** The built-in extensions, in order. `logDir` is where agent.jsonl goes. */
export function installExtensions(bus: EventBus, options: { logDir: string }) {
  blockSecretFiles(bus)
  logRuns(bus, options.logDir)
}
