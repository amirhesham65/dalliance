import { spawn, type ChildProcess } from 'node:child_process'
import { pythonEnv, redactSecrets } from '../secrets'

export function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid || child.exitCode != null || child.signalCode != null) return
  try {
    if (process.platform === 'win32') {
      if (signal === 'SIGKILL') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
      else child.kill(signal)
    } else process.kill(-child.pid, signal)
  } catch { /* The process has already exited. */ }
}

/** Bounded, cancellable subprocesses for app environments and interaction checks. */
export function appCommand(file: string, args: string[], options: { cwd: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number }): Promise<string> {
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: pythonEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    let out = '', errors = '', failure: string | null = null
    const stop = (reason: string) => { failure = reason; killGroup(child, 'SIGKILL') }
    const abort = () => stop('App operation stopped.')
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop('App command timed out.'), options.timeoutMs ?? 60_000)
    child.stdout.on('data', (data: Buffer) => {
      out += data.toString()
      if (Buffer.byteLength(out) > (options.maxBytes ?? 128_000)) stop('App command output exceeded its limit.')
    })
    child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString()).slice(-3000) })
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
    child.once('error', (err) => { cleanup(); reject(new Error(redactSecrets(err.message))) })
    child.once('exit', (code) => {
      cleanup()
      if (failure || code !== 0) reject(new Error(redactSecrets(failure || errors.trim() || `App command exited with ${code}.`)))
      else resolve(redactSecrets(out))
    })
  })
}
