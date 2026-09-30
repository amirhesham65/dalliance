// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Output } from '@dalliance/shared/notebook'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findSystemPython } from './python-env'
import { KILLED_AFTER_INTERRUPT, PythonKernel } from './python-kernel'

const python = await findSystemPython()
const hasData = python !== null && spawnSync(python, ['-c', 'import pandas, matplotlib'], { stdio: 'ignore' }).status === 0
const hasIPython = python !== null && spawnSync(python, ['-c', 'import sys, IPython; sys.exit(IPython.version_info[0] not in (8, 9))'], { stdio: 'ignore' }).status === 0

/**
 * Every suite runs on both of the script's paths: through IPython's InteractiveShell when it is installed,
 * and through plain exec and eval, forced with DALLIANCE_KERNEL_NO_IPYTHON.
 */
const PATHS = [
  { name: 'IPython', env: { DALLIANCE_KERNEL_NO_IPYTHON: '0' }, skip: !python || !hasIPython },
  { name: 'plain exec', env: { DALLIANCE_KERNEL_NO_IPYTHON: '1' }, skip: !python },
]

for (const { name, env, skip } of PATHS) {
  describe.skipIf(skip)(`PythonKernel (real Python, ${name})`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
    const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir, env })

    beforeAll(() => kernel.start(), 20_000)
    afterAll(() => kernel.shutdown())

    it('runs cells on this path', async () => {
      const r = await kernel.execute("import sys\n'IPython' in sys.modules", { store: false })
      expect(r.outputs).toEqual([{ type: 'text', text: name === 'IPython' ? 'True' : 'False' }])
    })

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

  describe.skipIf(skip)(`PythonKernel assigned names (${name})`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
    const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir, env })
    beforeAll(() => kernel.start(), 20_000)
    afterAll(() => kernel.shutdown())

    it('reports only the names a cell bound or rebound', async () => {
      await kernel.execute('a = 1\nb = [1, 2]', { store: true })
      const r = await kernel.execute('import math\nc = a + 1\nb = b + [3]', { store: true })
      expect(r.assigned.map((v) => v.name).sort()).toEqual(['b', 'c'])
      expect(r.assigned.find((v) => v.name === 'b')).toMatchObject({ type: 'list', shape: '3' })
    })
  })

  describe.skipIf(skip)(`PythonKernel hardening (${name})`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
    const scratch = mkdtempSync(path.join(tmpdir(), 'dalliance-scratch-'))
    const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: scratch, env })
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

  describe.skipIf(skip)(`PythonKernel output budgets (${name})`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
    const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir, env })
    beforeAll(async () => {
      await kernel.start()
      // The first pyplot import on a fresh machine builds matplotlib's font cache, which takes tens of seconds on
      // macOS. Pay for it here, so the figure test times the budgets and not the cache.
      if (hasData) await kernel.execute('import matplotlib.pyplot', { store: false })
    }, 120_000)
    afterAll(() => kernel.shutdown())

    const stdout = (outputs: Output[]) =>
      outputs
        .filter((o) => o.type === 'stream' && o.name === 'stdout')
        .map((o) => (o.type === 'stream' ? o.text : ''))
        .join('')

    it('caps stream text per run and says how much it dropped', async () => {
      const r = await kernel.execute("print('x' * 1_500_000)\nprint('never seen')", { store: true })
      expect(r.ok).toBe(true)
      expect(stdout(r.outputs)).toBe('x'.repeat(1_000_000))
      expect(r.outputs.at(-1)).toEqual({ type: 'stream', name: 'stderr', text: 'Output truncated: 500,012 more characters.\n' })
      // The next run gets a fresh budget
      expect((await kernel.execute("print('ok')", { store: false })).outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'ok\n' }])
    })

    it('coalesces many small writes into a few messages, in order', async () => {
      const r = await kernel.execute('for i in range(20000):\n    print(i)', { store: true })
      expect(stdout(r.outputs)).toBe(Array.from({ length: 20000 }, (_, i) => `${i}\n`).join(''))
      expect(r.outputs.length).toBeLessThan(20)
    })

    it('keeps prints and displayed values in order', async () => {
      const r = await kernel.execute("print('a')\ndisplay(1)\nprint('b')\n2", { store: false })
      expect(r.outputs).toEqual([
        { type: 'stream', name: 'stdout', text: 'a\n' },
        { type: 'text', text: '1' },
        { type: 'stream', name: 'stdout', text: 'b\n' },
        { type: 'text', text: '2' },
      ])
    })

    it('still sends a print before a long wait', async () => {
      const seen: Output[] = []
      const running = kernel.execute("import time\nprint('early')\ntime.sleep(1.5)", { store: false, onOutput: (o) => seen.push(o) })
      await new Promise((r) => setTimeout(r, 700))
      expect(seen).toEqual([{ type: 'stream', name: 'stdout', text: 'early\n' }])
      await running
    })

    it('caps displayed values per run', async () => {
      const r = await kernel.execute('for i in range(150):\n    display(i)', { store: false })
      expect(r.outputs.filter((o) => o.type === 'text')).toHaveLength(100)
      expect(r.outputs.at(-1)).toEqual({ type: 'stream', name: 'stderr', text: '50 more displayed values not shown (limit 100 per run).\n' })
    })

    it('clips a huge error message', async () => {
      const r = await kernel.execute("raise ValueError('e' * 1_000_000)", { store: false })
      const error = r.outputs.at(-1)
      expect(error).toMatchObject({ type: 'error', ename: 'ValueError' })
      expect(JSON.stringify(error).length).toBeLessThan(100_000)
    })

    it.skipIf(!hasData)('sends the first 50 columns of a wide table and notes the rest', async () => {
      const r = await kernel.execute("import pandas as pd\npd.DataFrame([['v' * 5000] * 120] * 3)", { store: false })
      const table = r.outputs[0]
      if (table.type !== 'table') throw new Error('expected a table')
      expect(table.columns).toHaveLength(50)
      expect(table.rows[0]).toHaveLength(50)
      expect(table.profile).toHaveLength(50)
      expect(String(table.rows[0][0]).length).toBeLessThan(1100)
      expect(r.outputs[1]).toEqual({ type: 'stream', name: 'stderr', text: 'Showing the first 50 of 120 columns.\n' })
    })

    it.skipIf(!hasData)('caps figures per run and their size', async () => {
      const many = await kernel.execute('import matplotlib.pyplot as plt\nfor i in range(25):\n    plt.figure(figsize=(1, 1))', { store: false })
      expect(many.outputs.filter((o) => o.type === 'image')).toHaveLength(20)
      expect(many.outputs.at(-1)).toEqual({ type: 'stream', name: 'stderr', text: '5 more figures not shown (limit 20 per run).\n' })

      const big = await kernel.execute('plt.figure(figsize=(60, 4))\nplt.plot([1, 2])\nplt.figure(figsize=(500, 2))', { store: false })
      const images = big.outputs.flatMap((o) => (o.type === 'image' ? [Buffer.from(o.data, 'base64')] : []))
      expect(images).toHaveLength(1)
      const [width, height] = [images[0].readUInt32BE(16), images[0].readUInt32BE(20)]
      expect(Math.max(width, height)).toBeLessThanOrEqual(4000)
      expect(width).toBeGreaterThan(3000)
      expect(big.outputs.at(-1)).toMatchObject({
        type: 'stream',
        name: 'stderr',
        text: expect.stringContaining('Figure 2 is 55,000 × 220 pixels, too big to show'),
      })
    }, 20_000)
  })

  describe.skipIf(skip)(`PythonKernel interrupt escalation (${name})`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
    const states: string[] = []
    const kernel = new PythonKernel({
      python: python!,
      cwd: dir,
      scratchDir: dir,
      env,
      interruptGraceMs: 600,
      onStatus: (info) => states.push(info.status),
    })
    beforeAll(() => kernel.start(), 20_000)
    afterAll(() => kernel.shutdown())

    it('leaves a kernel that stopped in time alone', async () => {
      await kernel.execute('kept = 1', { store: true })
      const running = kernel.execute('import time\nwhile True: time.sleep(0.05)', { store: true })
      await new Promise((r) => setTimeout(r, 300))
      kernel.interrupt()
      expect((await running).ok).toBe(false)
      await new Promise((r) => setTimeout(r, 900))
      expect(kernel.info().status).toBe('idle')
      expect((await kernel.execute('kept', { store: false })).outputs).toEqual([{ type: 'text', text: '1' }])
    })

    it('kills a run that swallows the interrupt, and fails what was queued', async () => {
      const code = 'import time\nwhile True:\n    try:\n        time.sleep(1)\n    except KeyboardInterrupt:\n        pass'
      const running = kernel.execute(code, { store: true })
      const queued = kernel.variables()
      await new Promise((r) => setTimeout(r, 300))
      const started = Date.now()
      kernel.interrupt()
      await new Promise((r) => setTimeout(r, 300))
      kernel.interrupt() // pressing Stop again doesn't push the deadline back
      await expect(running).rejects.toThrow(KILLED_AFTER_INTERRUPT)
      await expect(queued).rejects.toThrow(KILLED_AFTER_INTERRUPT)
      expect(Date.now() - started).toBeLessThan(800)
      expect(kernel.info()).toMatchObject({ status: 'dead', error: KILLED_AFTER_INTERRUPT })
      expect(states.at(-1)).toBe('dead')
      await expect(kernel.execute('1', { store: false })).rejects.toThrow(KILLED_AFTER_INTERRUPT)
    })

    it('starts fresh afterwards, without the old variables', async () => {
      await kernel.restart()
      const r = await kernel.execute('kept', { store: true })
      expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'NameError' })
      expect(kernel.info()).toMatchObject({ status: 'idle', error: null })
    }, 20_000)
  })
}

describe.skipIf(!python)('PythonKernel without IPython', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
  const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir, env: { DALLIANCE_KERNEL_NO_IPYTHON: '1' } })
  beforeAll(() => kernel.start(), 20_000)
  afterAll(() => kernel.shutdown())

  it('treats magics and top-level await as plain Python', async () => {
    for (const code of ['%time 1', '!echo hi', 'import asyncio\nawait asyncio.sleep(0)']) {
      const r = await kernel.execute(code, { store: false })
      expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'SyntaxError' })
    }
  })
})

/** Pic(width, height) shows as a PNG. It builds one itself, so the test needs neither Pillow nor matplotlib. */
const PNG_CLASS = `import struct, zlib
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
class Pic:
    def __init__(self, width=2, height=3):
        self.width, self.height = width, height
    def _repr_png_(self):
        rows = b''.join(b'\\x00' + b'\\x00\\x00\\x00' * self.width for _ in range(self.height))
        header = struct.pack('>IIBBBBB', self.width, self.height, 8, 2, 0, 0, 0)
        return b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    def __repr__(self):
        return 'Pic()'`

describe.skipIf(!python || !hasIPython)('PythonKernel with IPython', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-kernel-'))
  const kernel = new PythonKernel({ python: python!, cwd: dir, scratchDir: dir, env: { DALLIANCE_KERNEL_NO_IPYTHON: '0' }, interruptGraceMs: 3000 })
  beforeAll(() => kernel.start(), 20_000)
  afterAll(() => kernel.shutdown())

  const texts = (outputs: Output[]) => outputs.flatMap((o) => (o.type === 'text' || o.type === 'stream' ? [o.text] : [])).join('')

  it('runs magics', async () => {
    const r = await kernel.execute('%timeit -n 1 -r 1 sum(range(10))', { store: true })
    expect(r.ok).toBe(true)
    expect(texts(r.outputs)).toContain('per loop')
    const time = await kernel.execute('%time 6 * 7', { store: false })
    expect(time.outputs.at(-1)).toEqual({ type: 'text', text: '42' })
    expect(texts(time.outputs)).toContain('Wall time')
  })

  it('runs shell commands with an empty stdin, and Stop stops them', async () => {
    const r = await kernel.execute('n = 3\n!echo hi $n\n!cat', { store: true })
    expect(r.ok).toBe(true)
    expect(r.outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'hi 3\n' }])
    const running = kernel.execute('!sleep 30', { store: false })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const started = Date.now()
    kernel.interrupt()
    const stopped = await running
    expect(stopped.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'KeyboardInterrupt' })
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('refuses shell forms the code policy does not look for', async () => {
    const refused = ['files = !ls', 'files = %sx ls', 'ls', '%ls', '%alias say echo', '%%perl\nprint 1', '%time !ls', '%timeit -n 1 -r 1 !ls', '%time %sx ls']
    for (const code of refused) {
      const r = await kernel.execute(code, { store: false })
      expect(r.ok, code).toBe(false)
      expect(texts(r.outputs), code).toBe('')
    }
    // A command on its own line is one the policy sees, even in a cell magic's body
    const timed = await kernel.execute('%%time\n!echo timed', { store: false })
    expect(timed.ok).toBe(true)
    expect(texts(timed.outputs)).toMatch(/^timed\nCPU times/)
    expect((await kernel.execute('files = !ls', { store: false })).outputs).toEqual([
      expect.objectContaining({ type: 'error', ename: 'UsageError', evalue: expect.stringContaining("can't assign a shell command's output") }),
    ])
  })

  it('awaits at the top level', async () => {
    const r = await kernel.execute('import asyncio\nawait asyncio.sleep(0.01)\n"slept"', { store: false })
    expect(r.outputs).toEqual([{ type: 'text', text: "'slept'" }])
    const running = kernel.execute('await asyncio.sleep(30)', { store: false })
    await new Promise((resolve) => setTimeout(resolve, 300))
    kernel.interrupt()
    expect((await running).outputs).toEqual([{ type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: ['KeyboardInterrupt\n'] }])
  })

  it('shows an object with _repr_png_ as an image', async () => {
    await kernel.execute(PNG_CLASS, { store: false })
    const r = await kernel.execute('from IPython.display import display\ndisplay(Pic())\nPic()', { store: false })
    expect(r.outputs.map((o) => o.type)).toEqual(['image', 'image'])
    const image = r.outputs[0]
    if (image.type !== 'image') throw new Error('expected an image')
    const png = Buffer.from(image.data, 'base64')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2, 3])
    const huge = await kernel.execute('Pic(5000, 1)', { store: false })
    expect(huge.outputs).toEqual([{ type: 'stream', name: 'stderr', text: expect.stringContaining('5,000 × 1 pixels, too big to show') }])
  })

  it('caps displayed images per run', async () => {
    const r = await kernel.execute('for i in range(25):\n    display(Pic())', { store: false })
    expect(r.outputs.filter((o) => o.type === 'image')).toHaveLength(20)
    expect(r.outputs.at(-1)).toEqual({ type: 'stream', name: 'stderr', text: '5 more images not shown (limit 20 per run).\n' })
  })

  it('shows an object that only has HTML as text', async () => {
    const page = 'class Page:\n    def _repr_html_(self):\n        return "<b>bold</b>"\n    def __repr__(self):\n        return "Page()"\nPage()'
    expect((await kernel.execute(page, { store: false })).outputs).toEqual([{ type: 'text', text: 'Page()' }])
    const html = await kernel.execute('from IPython.display import HTML\ndisplay(HTML("<p>Hello <b>world</b></p><script>x()</script>"))', { store: false })
    expect(html.outputs).toEqual([{ type: 'text', text: 'Hello world' }])
    // With no repr of its own, the object's markup reads better than <__main__.Card at 0x...>
    const card = await kernel.execute('class Card:\n    def _repr_html_(self):\n        return "<h1>Title</h1><p>Body &amp; more</p>"\nCard()', { store: false })
    expect(card.outputs).toEqual([{ type: 'text', text: 'Title\nBody & more' }])
  })

  it.skipIf(!hasData)('keeps tables and figures on their own outputs', async () => {
    const code = '%matplotlib inline\nimport pandas as pd\nimport matplotlib.pyplot as plt\nframe = pd.DataFrame({"a": [1, 2]})\ndisplay(frame)\nplt.plot([1, 2])\nframe'
    const r = await kernel.execute(code, { store: false })
    expect(r.ok).toBe(true)
    expect(r.outputs.map((o) => o.type)).toEqual(['table', 'image', 'table'])
  }, 20_000)

  it('keeps _, Out and In for cell runs, and explore touches none of them', async () => {
    const first = await kernel.execute('6 * 7', { store: true })
    const n = first.executionCount!
    const peek = await kernel.execute('100', { store: false })
    expect(peek.executionCount).toBeNull()
    const next = await kernel.execute(`_, Out[${n}], In[${n}]`, { store: true })
    expect(next.executionCount).toBe(n + 1)
    expect(next.outputs).toEqual([{ type: 'text', text: "(42, 42, '6 * 7')" }])
    // Explore sees the history but doesn't add to it: _ is still the tuple afterwards
    expect((await kernel.execute('_[0], __', { store: false })).outputs).toEqual([{ type: 'text', text: '(42, 42)' }])
    expect((await kernel.execute(`type(_).__name__, ${n + 1} in Out, ${n + 2} in Out`, { store: false })).outputs).toEqual([
      { type: 'text', text: "('tuple', True, False)" },
    ])
  })

  it('hides a value when the cell ends with a semicolon', async () => {
    expect((await kernel.execute('1 + 1;', { store: false })).outputs).toEqual([])
    expect((await kernel.execute('%time 1 + 1;', { store: false })).outputs.filter((o) => o.type === 'text')).toEqual([])
  })

  it('leaves IPython out of tracebacks and the variables list', async () => {
    const r = await kernel.execute('def f():\n    return 1 / 0\nf()', { store: true })
    const err = r.outputs.at(-1)
    if (err?.type !== 'error') throw new Error('expected an error')
    expect(err.traceback[0]).toBe('Traceback (most recent call last):\n')
    expect(err.traceback.slice(1, -1).map((frame) => frame.split('\n')[0])).toEqual([
      expect.stringMatching(/line 3, in <module>$/),
      expect.stringMatching(/line 2, in f$/),
    ])
    const names = (await kernel.variables()).map((v) => v.name)
    for (const hidden of ['In', 'Out', 'get_ipython', 'exit', 'quit', 'open']) expect(names).not.toContain(hidden)
    expect((await kernel.execute('Out = 5', { store: true })).assigned.map((v) => v.name)).toEqual(['Out'])
  })

  it('keeps input() refused', async () => {
    const r = await kernel.execute('input("name? ")', { store: false })
    expect(r.outputs.at(-1)).toMatchObject({ type: 'error', ename: 'EOFError', evalue: expect.stringContaining("can't read input") })
  })
})
