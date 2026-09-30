// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSystemPython } from './python-env'
import { PythonKernel } from './python-kernel'

const python = await findSystemPython()

describe.skipIf(!python)('PythonKernel (real Python)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
  const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir })

  beforeAll(() => kernel.start(), 20_000)
  afterAll(() => kernel.shutdown())

  it('keeps state between cells and shows the last expression', async () => {
    await kernel.execute('x = 20', { store: true })
    const r = await kernel.execute('print("hi")\nx * 2 + 2', { store: true })
    expect(r.ok).toBe(true)
    expect(r.executionCount).toBe(2)
    expect(r.outputs).toEqual([
      { type: 'stream', name: 'stdout', text: 'hi\n' },
      { type: 'text', text: '42' },
    ])
  })

  it('reports errors with a traceback that starts at the user code', async () => {
    const r = await kernel.execute('1 / 0', { store: true })
    expect(r.ok).toBe(false)
    const err = r.outputs.find((o) => o.type === 'error')
    expect(err).toMatchObject({ type: 'error', ename: 'ZeroDivisionError' })
    expect(JSON.stringify(err)).not.toContain('dalliance_kernel.py')
  })

  it('does not advance the counter for exploratory runs', async () => {
    const r = await kernel.execute('x', { store: false })
    expect(r.executionCount).toBeNull()
    expect(r.outputs).toEqual([{ type: 'text', text: '20' }])
  })

  it('lists variables with their types', async () => {
    await kernel.execute('names = ["a", "b", "c"]', { store: true })
    const vars = await kernel.variables()
    expect(vars).toContainEqual({ name: 'x', type: 'int', shape: '', detail: '20' })
    expect(vars.find((v) => v.name === 'names')).toMatchObject({ type: 'list', shape: '3' })
  })

  it('stops a long run on interrupt', async () => {
    const running = kernel.execute('import time\nwhile True: time.sleep(0.05)', { store: true })
    await new Promise((r) => setTimeout(r, 300))
    kernel.interrupt()
    const r = await running
    expect(r.ok).toBe(false)
    expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'KeyboardInterrupt' })
    const after = await kernel.execute('x', { store: false })
    expect(after.ok).toBe(true)
  })

  it('starts fresh after a restart', async () => {
    await kernel.restart()
    const r = await kernel.execute('x', { store: true })
    expect(r.ok).toBe(false)
    expect(r.executionCount).toBe(1)
  }, 20_000)
})

describe.skipIf(!python)('PythonKernel assigned names', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
  const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir })
  beforeAll(() => kernel.start(), 20_000)
  afterAll(() => kernel.shutdown())

  it('reports only the names a cell bound or rebound', async () => {
    await kernel.execute('a = 1\nb = [1, 2]', { store: true })
    const r = await kernel.execute('import math\nc = a + 1\nb = b + [3]', { store: true })
    expect(r.assigned.map((v) => v.name).sort()).toEqual(['b', 'c'])
    expect(r.assigned.find((v) => v.name === 'b')).toMatchObject({ type: 'list', shape: '3' })
  })
})

describe.skipIf(!python)('PythonKernel hardening', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
  const scratch = mkdtempSync(path.join(tmpdir(), 'dalliance-scratch-'))
  const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: scratch })
  const keys = ['AI_GATEWAY_API_KEY', 'ANTHROPIC_API_KEY']
  const saved = keys.map((key) => process.env[key])

  beforeAll(() => {
    for (const key of keys) process.env[key] = 'secret'
    return kernel.start()
  }, 20_000)
  afterAll(async () => {
    await kernel.shutdown()
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]
      else process.env[key] = saved[i]
    })
  })

  const value = async (code: string) => (await kernel.execute(code, { store: false })).outputs

  it('survives a value that breaks describe()', async () => {
    const r = await kernel.execute('class T:\n    shape = (None, 10)\nt = T()', { store: true })
    expect(r.ok).toBe(true)
    expect(r.assigned).toEqual([{ name: 't', type: 'T', shape: '', detail: '' }])
    expect(await kernel.variables()).toContainEqual({ name: 't', type: 'T', shape: '', detail: '' })
    expect(await value('1 + 1')).toEqual([{ type: 'text', text: '2' }])
  })

  it('answers with an error when a request fails outside the cell, and keeps running', async () => {
    const code = 'class B:\n    @property\n    def shape(self):\n        raise SystemExit(3)\nb = B()'
    const r = await kernel.execute(code, { store: true })
    expect(r.ok).toBe(false)
    expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'SystemExit' })
    await value('del b')
    expect(await value('1 + 1')).toEqual([{ type: 'text', text: '2' }])
  })

  it("imports modules from the notebook's folder", async () => {
    writeFileSync(path.join(dir, 'helpers.py'), 'def hi():\n    return "hello"\n')
    expect(await value('import helpers\nhelpers.hi()')).toEqual([{ type: 'text', text: "'hello'" }])
    expect(await value('import sys\nsys.path[0]')).toEqual([{ type: 'text', text: "''" }])
    expect(await value(`${JSON.stringify(scratch)} in sys.path`)).toEqual([{ type: 'text', text: 'False' }])
  })

  it('does not pass API keys to the kernel', async () => {
    const code = `import os\n[k for k in ${JSON.stringify(keys)} if k in os.environ]`
    expect(await value(code)).toEqual([{ type: 'text', text: '[]' }])
  })

  it('gives cells an empty stdin instead of the request pipe', async () => {
    const r = await kernel.execute('input("name? ")', { store: true })
    expect(r.ok).toBe(false)
    expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'EOFError', evalue: expect.stringContaining("can't read input") })
    expect(await value('import sys\nsys.stdin.read()')).toEqual([{ type: 'text', text: "''" }])
    // A subprocess inherits fd 0, so it must not see the requests either
    const child = 'import subprocess\nsubprocess.run([sys.executable, "-c", "import sys; print(len(sys.stdin.read()))"], capture_output=True, text=True).stdout'
    expect(await value(child)).toEqual([{ type: 'text', text: "'0\\n'" }])
    expect(await value('1 + 1')).toEqual([{ type: 'text', text: '2' }])
  })
})
