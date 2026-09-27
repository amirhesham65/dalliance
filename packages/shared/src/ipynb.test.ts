import { describe, expect, it } from 'vitest'
import { fromIpynb, toIpynb } from './ipynb'
import { type PromptCell, needsGeneration, newNoteCell, newPromptCell, parseInterpretation } from './notebook'

describe('ipynb', () => {
  it('round-trips prompts, code and every output type', () => {
    const cell: PromptCell = {
      ...newPromptCell('Monthly churn by plan', 'churn = subs.groupby("plan").churned.mean()\nchurn'),
      interpretation: 'Churned means [[cancelled within the month]].',
      answer: 'Pro churns most.',
      suggestions: ['Plot churn by month'],
      history: [{ at: 1_700_000_000_000, prompt: 'Churn by plan', code: 'subs.churned.mean()', interpretation: null, answer: null, edited: false }],
      showTables: true,
      executionCount: 3,
      state: 'done',
      durationMs: 1800,
      outputs: [
        { type: 'stream', name: 'stdout', text: 'loaded\nok\n' },
        { type: 'table', columns: ['plan', 'churn'], index: ['0', '1'], rows: [['Pro', 3.8], ['Team', null]], totalRows: 2 },
        { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' },
        { type: 'text', text: '42' },
        { type: 'error', ename: 'KeyError', evalue: "'x'", traceback: ['Traceback...', "KeyError: 'x'"] },
      ],
    }
    const nb = { cells: [newNoteCell('# Title\nIntro'), cell] }
    const back = fromIpynb(JSON.parse(JSON.stringify(toIpynb(nb))))

    expect(back.cells[0]).toMatchObject({ kind: 'note', markdown: '# Title\nIntro' })
    // Saved outputs are shown but marked out of date: the kernel that made them is gone
    expect(back.cells[1]).toEqual({ ...cell, state: 'stale' })
  })

  it('writes a notebook Jupyter can open', () => {
    const json = toIpynb({ cells: [newPromptCell('Say hi', 'print("hi")')] }) as { nbformat: number; cells: { cell_type: string; source: string[] }[] }
    expect(json.nbformat).toBe(4)
    expect(json.cells[0]).toMatchObject({ cell_type: 'code', source: ['print("hi")'] })
  })

  it('opens plain Jupyter notebooks as runnable code cells', () => {
    const nb = fromIpynb({
      nbformat: 4,
      cells: [
        { cell_type: 'markdown', source: ['# Analysis'] },
        { cell_type: 'code', execution_count: null, source: ['import pandas as pd\n', 'pd.__version__'], outputs: [], metadata: {} },
      ],
    })
    const cell = nb.cells[1] as PromptCell
    expect(cell).toMatchObject({ kind: 'prompt', prompt: '', code: 'import pandas as pd\npd.__version__', state: 'idle' })
    expect(needsGeneration(cell)).toBe(false)
  })

  it('rejects files that are not notebooks', () => {
    expect(() => fromIpynb({ hello: 'world' })).toThrow('Not a notebook file')
  })
})

describe('needsGeneration', () => {
  const base = newPromptCell('Average order value', 'orders.total.mean()')
  it('reruns existing code when the prompt is unchanged', () => expect(needsGeneration(base)).toBe(false))
  it('regenerates when the prompt changed', () => expect(needsGeneration({ ...base, prompt: 'Median order value' })).toBe(true))
  it('keeps hand-edited code', () => expect(needsGeneration({ ...base, prompt: 'Median', codeEdited: true })).toBe(false))
  it('regenerates when an assumption was corrected', () =>
    expect(needsGeneration({ ...base, corrections: [{ from: 'a', to: 'b' }] })).toBe(true))
  it('generates when there is no code yet', () => expect(needsGeneration(newPromptCell('Plot it'))).toBe(true))
  it('retries after a failed generation', () => expect(needsGeneration({ ...base, generatedFrom: '' })).toBe(true))
})

describe('parseInterpretation', () => {
  it('splits out [[assumptions]]', () => {
    expect(parseInterpretation('Churn means [[cancelled]] in [[2026]].')).toEqual([
      { text: 'Churn means ', assumption: false },
      { text: 'cancelled', assumption: true },
      { text: ' in ', assumption: false },
      { text: '2026', assumption: true },
      { text: '.', assumption: false },
    ])
  })
})
