import { pythonEnv } from '../secrets'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { Output } from '@dalliance/shared/notebook'
import type { ExecuteOptions, ExecuteResult, FilesRead, Kernel, KernelEnvironment, KernelInfo, KernelStatus, VariableInfo } from './kernel'
import kernelSource from './dalliance_kernel.py?raw'

interface Pending {
  outputs: Output[]
  onOutput?: (o: Output) => void
  resolve: (msg: Record<string, unknown>) => void
  reject: (err: Error) => void
}

export interface PythonKernelOptions {
  python: string
  cwd: string
  /** Where to write the kernel script. */
  scratchDir: string
  env?: NodeJS.ProcessEnv
  onStatus?: (info: KernelInfo) => void
  /** How long a run may keep going after interrupt() before the process is killed. */
  interruptGraceMs?: number
}

function filesRead(v: unknown): FilesRead {
  const o = (v ?? {}) as { paths?: unknown; truncated?: unknown }
  return { paths: Array.isArray(o.paths) ? o.paths.filter((p): p is string => typeof p === 'string') : [], truncated: o.truncated === true }
}

/** What a request that was still running gets when interrupt() had to kill the kernel. */
export const KILLED_AFTER_INTERRUPT = "The kernel didn't stop, so it was restarted. Variables were lost."

export class PythonKernel implements Kernel {
  private child: ChildProcess | null = null
  private status: KernelStatus = 'dead'
  private python: string | null = null
  private executable: string | null = null
  private error: string | null = null
  private pending = new Map<string, Pending>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 0
  private ready: Promise<void> = Promise.resolve()
  private stderrTail = ''
  /** Kills the process if the interrupted request is still running when it fires. */
  private escalation: ReturnType<typeof setTimeout> | null = null
  private readonly options: PythonKernelOptions

  constructor(options: PythonKernelOptions) {
    this.options = options
  }

  info(): KernelInfo {
    return { status: this.status, python: this.python, executable: this.executable, cwd: this.options.cwd, error: this.error }
  }

  start(): Promise<void> {
    mkdirSync(this.options.scratchDir, { recursive: true })
    const script = path.join(this.options.scratchDir, 'dalliance_kernel.py')
    writeFileSync(script, kernelSource)
    this.setStatus('starting')
    this.error = null
    this.stderrTail = ''

    const env = { ...pythonEnv({ ...process.env, ...this.options.env }), MPLBACKEND: 'Agg', PYTHONUNBUFFERED: '1' }
    const child = spawn(this.options.python, ['-u', script], {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })
    this.child = child

    // Anything written straight to stdout/stderr by C extensions is kept for error messages only
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000)
    })

    this.ready = new Promise<void>((resolve, reject) => {
      const lines = createInterface({ input: child.stdio[3] as Readable })
      lines.on('line', (line) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          return
        }
        if (msg.type === 'ready') {
          this.python = String(msg.python)
          this.executable = String(msg.executable)
          this.setStatus('idle')
          resolve()
          return
        }
        const pending = this.pending.get(String(msg.id))
        if (!pending) return
        if (msg.type === 'output') {
          const output = msg.output as Output
          pending.outputs.push(output)
          pending.onOutput?.(output)
        } else {
          this.pending.delete(String(msg.id))
          this.clearEscalation()
          pending.resolve(msg)
        }
      })
      child.on('error', (err) => {
        this.error = `Could not start Python (${this.options.python}): ${err.message}`
        this.setStatus('dead')
        reject(new Error(this.error))
      })
      child.on('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = null
        this.clearEscalation()
        if (this.status !== 'dead') {
          const why = this.stderrTail.trim() || `exited with ${signal ?? `code ${code}`}`
          this.error = `The Python kernel stopped: ${why}`
        }
        this.setStatus('dead')
        for (const p of this.pending.values()) p.reject(new Error(this.error ?? 'The Python kernel stopped.'))
        this.pending.clear()
        reject(new Error(this.error ?? 'The Python kernel stopped.'))
      })
    })
    return this.ready
  }

  private setStatus(status: KernelStatus) {
    this.status = status
    this.options.onStatus?.(this.info())
  }

  /** Requests run one at a time, in order, like a Jupyter kernel's shell channel. */
  private request(payload: Record<string, unknown>, onOutput?: (o: Output) => void) {
    const run = async () => {
      await this.ready
      if (!this.child?.stdin) throw new Error(this.error ?? 'The Python kernel is not running.')
      const id = String(++this.nextId)
      const outputs: Output[] = []
      const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        this.pending.set(id, { outputs, onOutput, resolve, reject })
      })
      this.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
      const msg = await result
      return { msg, outputs }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => {})
    return next
  }

  async execute(code: string, options: ExecuteOptions): Promise<ExecuteResult> {
    this.setStatus('busy')
    try {
      const { msg, outputs } = await this.request({ op: 'execute', code, store: options.store }, options.onOutput)
      return {
        ok: Boolean(msg.ok),
        outputs,
        executionCount: typeof msg.executionCount === 'number' ? msg.executionCount : null,
        durationMs: Number(msg.durationMs ?? 0),
        assigned: (msg.assigned as VariableInfo[] | undefined) ?? [],
        filesRead: filesRead(msg.filesRead),
      }
    } finally {
      if (this.status === 'busy') this.setStatus('idle')
    }
  }

  async variables(): Promise<VariableInfo[]> {
    const { msg } = await this.request({ op: 'variables' })
    return (msg.variables as VariableInfo[]) ?? []
  }

  async environment(): Promise<KernelEnvironment> {
    const { msg } = await this.request({ op: 'environment' })
    const packages = Array.isArray(msg.packages) ? (msg.packages as unknown[]) : []
    return {
      python: typeof msg.python === 'string' ? msg.python : (this.python ?? ''),
      packages: packages
        .filter((p): p is { name: string; version: unknown } => typeof (p as { name?: unknown } | null)?.name === 'string')
        .map((p) => ({ name: p.name, version: typeof p.version === 'string' ? p.version : '' })),
    }
  }

  /**
   * Send SIGINT, like Ctrl+C. A run that is still going after the grace period, because it swallowed the
   * KeyboardInterrupt or sits in C code that never checks for signals, gets the process killed instead:
   * pending requests reject with KILLED_AFTER_INTERRUPT and the status goes dead, so the next use starts a new one.
   */
  interrupt() {
    const child = this.child
    if (!child || this.status !== 'busy') return
    child.kill('SIGINT')
    if (this.escalation) return
    this.escalation = setTimeout(() => {
      this.escalation = null
      if (this.child === child && this.pending.size > 0) this.kill(child)
    }, this.options.interruptGraceMs ?? 5000)
  }

  private clearEscalation() {
    if (this.escalation) clearTimeout(this.escalation)
    this.escalation = null
  }

  private kill(child: ChildProcess) {
    this.child = null
    this.error = KILLED_AFTER_INTERRUPT
    this.setStatus('dead')
    for (const p of this.pending.values()) p.reject(new Error(KILLED_AFTER_INTERRUPT))
    this.pending.clear()
    child.kill('SIGKILL')
  }

  async restart() {
    await this.shutdown()
    await this.start()
  }

  async shutdown() {
    const child = this.child
    if (!child) return
    this.child = null
    this.clearEscalation()
    this.setStatus('dead')
    this.error = null
    for (const p of this.pending.values()) p.reject(new Error('The kernel was restarted.'))
    this.pending.clear()
    this.queue = Promise.resolve()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.stdin?.end()
      child.kill('SIGTERM')
    })
  }
}
