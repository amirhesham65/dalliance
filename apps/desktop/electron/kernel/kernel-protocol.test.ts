// @vitest-environment node
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSystemPython } from './python-env'

const python = await findSystemPython()
const script = fileURLToPath(new URL('./dalliance_kernel.py', import.meta.url))
const hasIPython = python !== null && spawnSync(python, ['-c', 'import sys, IPython; sys.exit(IPython.version_info[0] not in (8, 9))'], { stdio: 'ignore' }).status === 0

type Message = { id: string | null; type: string; [key: string]: unknown }

/** Drives the script over raw pipes, so a torn protocol line shows up instead of being skipped. */
class RawKernel {
  readonly torn: string[] = []
  readonly messages: Message[] = []
  private readonly child: ChildProcess
  private waiters: { test: (m: Message) => boolean; resolve: (m: Message) => void }[] = []

  constructor(cwd: string, env: NodeJS.ProcessEnv = {}) {
    this.child = spawn(python!, ['-u', script], { cwd, env: { ...process.env, ...env, MPLBACKEND: 'Agg' }, stdio: ['pipe', 'ignore', 'ignore', 'pipe'] })
    createInterface({ input: this.child.stdio[3] as Readable }).on('line', (line) => {
      let msg: Message
      try {
        msg = JSON.parse(line)
      } catch {
        this.torn.push(line.slice(0, 120))
        return
      }
      this.messages.push(msg)
      this.waiters = this.waiters.filter((w) => !(w.test(msg) && (w.resolve(msg), true)))
    })
  }

  next(test: (m: Message) => boolean, timeoutMs = 10_000): Promise<Message> {
    const seen = this.messages.find(test)
    if (seen) return Promise.resolve(seen)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a protocol message')), timeoutMs)
      this.waiters.push({ test, resolve: (m) => (clearTimeout(timer), resolve(m)) })
    })
  }

  send(request: Record<string, unknown>) {
    ;(this.child.stdio[0] as Writable).write(`${JSON.stringify(request)}\n`)
  }

  interrupt() {
    this.child.kill('SIGINT')
  }

  stop() {
    this.child.kill('SIGKILL')
  }
}

// Both of the script's paths: IPython's InteractiveShell, and plain exec and eval
const PATHS = [
  { name: 'IPython', env: { DALLIANCE_KERNEL_NO_IPYTHON: '0' }, skip: !python || !hasIPython },
  { name: 'plain exec', env: { DALLIANCE_KERNEL_NO_IPYTHON: '1' }, skip: !python },
]

for (const { name, env, skip } of PATHS) {
  describe.skipIf(skip)(`kernel protocol under interrupts (${name})`, () => {
    let kernel: RawKernel
    beforeAll(() => {
      // Started here, not while collecting, so a skipped path leaves no process behind
      kernel = new RawKernel(mkdtempSync(path.join(tmpdir(), 'dalliance-protocol-')), env)
      return kernel.next((m) => m.type === 'ready', 20_000)
    }, 20_000)
    afterAll(() => kernel.stop())

    const loops = [
      "while True:\n    print('x' * 100000)",
      "while True:\n    display('y' * 100000)",
      "import sys\nwhile True:\n    sys.stderr.write('z' * 70000)\n    print('.', end='')",
    ]

    it('never tears a line and always finishes the request', async () => {
      let id = 0
      for (let round = 0; round < 12; round++) {
        const rid = String(++id)
        kernel.send({ id: rid, op: 'execute', code: loops[round % loops.length], store: false })
        await kernel.next((m) => m.id === rid && m.type === 'output')
        await new Promise((r) => setTimeout(r, 5 + round * 7))
        kernel.interrupt()
        const done = await kernel.next((m) => m.id === rid && m.type === 'done')
        expect(done.ok).toBe(false)
      }
      const last = String(++id)
      kernel.send({ id: last, op: 'execute', code: '1 + 1', store: false })
      const done = await kernel.next((m) => m.id === last && m.type === 'done')
      expect(done.ok).toBe(true)
      expect(kernel.messages.find((m) => m.id === last && m.type === 'output')).toMatchObject({ output: { type: 'text', text: '2' } })
      expect(kernel.torn).toEqual([])
    }, 60_000)
  })

  describe.skipIf(skip)(`kernel protocol for files read (${name})`, () => {
    let kernel: RawKernel
    beforeAll(() => {
      const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-protocol-'))
      writeFileSync(path.join(dir, 'orders.csv'), 'plan,total\n')
      kernel = new RawKernel(dir, env)
      return kernel.next((m) => m.type === 'ready', 20_000)
    }, 20_000)
    afterAll(() => kernel.stop())

    it('sends what a run read on fd 3, with its done line', async () => {
      kernel.send({ id: 'r1', op: 'execute', code: 'open("orders.csv").read()', store: true })
      const done = await kernel.next((m) => m.id === 'r1' && m.type === 'done')
      expect(done.filesRead).toEqual({ paths: ['orders.csv'], truncated: false })
      kernel.send({ id: 'r2', op: 'execute', code: '1 + 1', store: false })
      expect((await kernel.next((m) => m.id === 'r2' && m.type === 'done')).filesRead).toEqual({ paths: [], truncated: false })
    })
  })
}
