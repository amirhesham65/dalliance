import { describe, expect, it } from 'vitest'
import { canonicalOutputs, normalizeOutputs, normalizeText } from './normalize'
import type { Output } from './notebook'

describe('normalizeText', () => {
  it('takes out memory addresses', () => {
    expect(normalizeText('<__main__.Card object at 0x10f3a2b50>')).toBe('<__main__.Card object at 0x…>')
    expect(normalizeText('<function f at 0x7f8b2c3d4e50>')).toBe('<function f at 0x…>')
    // Short hex values are data, not addresses
    expect(normalizeText('mask 0xff00')).toBe('mask 0xff00')
  })

  it("takes out the cell's number from a traceback", () => {
    expect(normalizeText('  File "<cell 12>", line 3, in <module>')).toBe('  File "<cell>", line 3, in <module>')
    expect(normalizeText('Cell In[7], line 2')).toBe('Cell In[ ], line 2')
    expect(normalizeText('<ipython-input-3-9f2c1a>')).toBe('<ipython-input>')
  })

  it('takes out timings from %time and %timeit', () => {
    expect(normalizeText('CPU times: user 1.2 ms, sys: 0 ns, total: 1.2 ms\nWall time: 1.3 ms\n42\n')).toBe('CPU times: …\nWall time: …\n42\n')
    expect(normalizeText('10.2 µs ± 81.6 ns per loop (mean ± std. dev. of 7 runs, 100,000 loops each)')).toBe('… per loop')
  })

  it('drops colour codes and Windows line ends', () => {
    expect(normalizeText('\x1b[0;31mKeyError\x1b[0m\r\nnext')).toBe('KeyError\nnext')
  })

  it('leaves numbers and words alone', () => {
    const text = 'Mean 41.20, n = 1,024, p = 0.03\nplan\ttotal'
    expect(normalizeText(text)).toBe(text)
  })
})

describe('normalizeOutputs', () => {
  it('joins printed text however the kernel split it', () => {
    const one: Output[] = [{ type: 'stream', name: 'stdout', text: 'a\nb\n' }]
    const split: Output[] = [
      { type: 'stream', name: 'stdout', text: 'a\n' },
      { type: 'stream', name: 'stdout', text: 'b\n' },
    ]
    expect(normalizeOutputs(split)).toEqual(one)
    expect(canonicalOutputs(split)).toBe(canonicalOutputs(one))
    // stdout and stderr stay apart
    expect(normalizeOutputs([...split, { type: 'stream', name: 'stderr', text: 'warn\n' }])).toHaveLength(2)
  })

  it('normalizes errors and table text, and leaves images and numbers exact', () => {
    const outputs: Output[] = [
      { type: 'error', ename: 'TypeError', evalue: 'bad <X object at 0x1234567890>', traceback: ['File "<cell 4>", line 1'] },
      { type: 'table', columns: ['obj'], index: ['0'], rows: [['<X at 0xabcdef12>', 1.5]], totalRows: 1 },
      { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo0x1234567890=' },
    ]
    expect(normalizeOutputs(outputs)).toEqual([
      { type: 'error', ename: 'TypeError', evalue: 'bad <X object at 0x…>', traceback: ['File "<cell>", line 1'] },
      { type: 'table', columns: ['obj'], index: ['0'], rows: [['<X at 0x…>', 1.5]], totalRows: 1 },
      outputs[2],
    ])
  })
})

describe('canonicalOutputs', () => {
  it('is the same whatever order the keys came in', () => {
    const a: Output[] = [{ type: 'table', columns: ['a'], index: ['0'], rows: [[1]], totalRows: 1 }]
    const b = [{ totalRows: 1, rows: [[1]], index: ['0'], columns: ['a'], type: 'table' }] as Output[]
    expect(canonicalOutputs(a)).toBe(canonicalOutputs(b))
  })

  it('differs when a value differs', () => {
    expect(canonicalOutputs([{ type: 'text', text: '41.2' }])).not.toBe(canonicalOutputs([{ type: 'text', text: '41.3' }]))
    expect(canonicalOutputs([])).toBe('[]')
  })
})
