// @vitest-environment node
import { mkdtempSync } from 'node:fs'
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
