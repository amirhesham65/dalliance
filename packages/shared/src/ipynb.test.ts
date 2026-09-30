import { describe, expect, it } from 'vitest'
import { FORMAT_VERSION, TABLE_MIME, fromIpynb, toIpynb } from './ipynb'
import { type PromptCell, type Provenance, needsGeneration, newNoteCell, newPromptCell, parseInterpretation } from './notebook'

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
    expect(() => fromIpynb(null)).toThrow('Not a notebook file')
    expect(() => fromIpynb('cells')).toThrow('Not a notebook file')
  })
})

describe('ipynb format version', () => {
  const withVersion = (version: unknown) => ({ nbformat: 4, metadata: { dalliance: { version } }, cells: [{ cell_type: 'markdown', source: ['hi'] }] })

  it('writes the current version', () => {
    expect(toIpynb({ cells: [] })).toMatchObject({ metadata: { dalliance: { version: FORMAT_VERSION } } })
  })

  it('refuses a file from a newer version of Dalliance', () => {
    expect(() => fromIpynb(withVersion(FORMAT_VERSION + 1))).toThrow('This notebook was saved by a newer version of Dalliance. Update the app to open it.')
  })

  it('reads the current version and older ones', () => {
    expect(fromIpynb(withVersion(FORMAT_VERSION)).cells).toHaveLength(1)
    expect(fromIpynb(withVersion(0)).cells).toHaveLength(1)
  })

  it('reads a missing or non-numeric version as 1', () => {
    expect(fromIpynb({ nbformat: 4, metadata: {}, cells: [] }).cells).toEqual([])
    expect(fromIpynb({ nbformat: 4, cells: [] }).cells).toEqual([])
    expect(fromIpynb({ nbformat: 4, metadata: { dalliance: 'x' }, cells: [] }).cells).toEqual([])
    expect(fromIpynb(withVersion('99')).cells).toHaveLength(1)
    expect(fromIpynb(withVersion(null)).cells).toHaveLength(1)
  })
})

describe('reading hand-edited or corrupted metadata', () => {
  // One code cell with the given metadata.dalliance, read back
  const read = (dalliance: unknown, extra: Record<string, unknown> = {}): PromptCell =>
    fromIpynb({ nbformat: 4, cells: [{ cell_type: 'code', source: ['x = 1'], metadata: { dalliance }, outputs: [], ...extra }] }).cells[0] as PromptCell

  it('saves and reads back a fully populated cell unchanged', () => {
    const cell: PromptCell = {
      ...newPromptCell('Revenue by region for the last quarter', 'rev = orders.groupby("region").total.sum()'),
      title: 'Revenue by region',
      titleFrom: 'Revenue by region for the last quarter',
      codeEdited: true,
      interpretation: 'Last quarter means [[Q3 2026]].',
      answer: 'The **West** leads.',
      suggestions: ['Plot it', 'Compare to Q2'],
      history: [
        { at: 1_700_000_000_001, prompt: 'Revenue by region', code: 'orders.total.sum()', interpretation: 'All time.', answer: null, edited: true },
        { at: 1_700_000_000_000, prompt: 'Revenue', code: 'orders.total', interpretation: null, answer: 'Some', edited: false },
      ],
      variables: [{ name: 'rev', type: 'Series', shape: '4' }],
      showTables: false,
      executionCount: 7,
      durationMs: 250,
      outputs: [
        {
          type: 'table',
          columns: ['region', 'total'],
          index: ['0'],
          rows: [['West', 12.5]],
          totalRows: 1,
          profile: [{ name: 'total', dtype: 'float64', kind: 'number', count: 1, missing: 0, unique: 1, min: 12.5, max: 12.5, mean: 12.5 }],
        },
      ],
    }
    const plain = { ...newPromptCell('', 'print(1)'), generatedFrom: null }
    const saved = JSON.parse(JSON.stringify(toIpynb({ cells: [cell, plain, newNoteCell('Notes')] })))
    const back = fromIpynb(saved)
    expect(back.cells).toEqual([{ ...cell, state: 'stale' }, plain, expect.objectContaining({ kind: 'note', markdown: 'Notes' })])
    // Saving again writes the same file, apart from the state the reader resets
    const again = JSON.parse(JSON.stringify(toIpynb(back)))
    saved.cells[0].metadata.dalliance.state = 'stale'
    expect({ ...again, cells: again.cells.slice(0, 2) }).toEqual({ ...saved, cells: saved.cells.slice(0, 2) })
  })

  it('treats mistyped text fields as missing', () => {
    const cell = read({ prompt: 5, title: ['a'], titleFrom: {}, interpretation: 42, answer: false })
    expect(cell).toMatchObject({ prompt: '', title: null, titleFrom: null, interpretation: null, answer: null })
  })

  it('treats a mistyped generatedFrom as missing and keeps an explicit null', () => {
    expect(read({ prompt: 'Set x', generatedFrom: 3 }).generatedFrom).toBe('Set x')
    expect(read({ prompt: 'Set x', generatedFrom: null }).generatedFrom).toBeNull()
    expect(read({ prompt: 'Set x', generatedFrom: '' }).generatedFrom).toBe('')
  })

  it('reads codeEdited only when it is true', () => {
    expect(read({ codeEdited: 'false' }).codeEdited).toBe(false)
    expect(read({ codeEdited: 1 }).codeEdited).toBe(false)
    expect(read({ codeEdited: true }).codeEdited).toBe(true)
  })

  it('drops suggestions that are not strings', () => {
    expect(read({ suggestions: 'Plot it' }).suggestions).toEqual([])
    expect(read({ suggestions: ['Plot it', 7, null] }).suggestions).toEqual(['Plot it'])
  })

  it('drops malformed history entries and fills in missing revision fields', () => {
    expect(read({ history: 'none' }).history).toEqual([])
    expect(read({ history: [null, 3, 'x', [], { prompt: 'no code' }, { code: 7 }] }).history).toEqual([])
    expect(read({ history: [null, { code: 'x = 2', at: 'now', prompt: 1, interpretation: 5, answer: {}, edited: 'yes' }] }).history).toEqual([
      { at: 0, prompt: '', code: 'x = 2', interpretation: null, answer: null, edited: false },
    ])
  })

  it('drops malformed variables', () => {
    expect(read({ variables: 'x' }).variables).toEqual([])
    expect(read({ variables: [null, 'x', { type: 'int' }, { name: 'x', type: 1 }] }).variables).toEqual([{ name: 'x', type: '', shape: '' }])
  })

  it('treats mistyped showTables and durationMs as missing', () => {
    expect(read({ showTables: 'yes', durationMs: '5' })).toMatchObject({ showTables: null, durationMs: null })
  })

  it('ignores a saved state and a mistyped execution count', () => {
    expect(read({ state: 'running' }, { execution_count: '3' })).toMatchObject({ state: 'idle', executionCount: null })
    expect(read({ state: 42 }, { execution_count: 3 })).toMatchObject({ state: 'stale', executionCount: 3 })
  })

  it('reads a mistyped dalliance block as a plain Jupyter cell', () => {
    for (const dalliance of [null, 'x', 5, ['a']]) {
      const cell = read(dalliance)
      expect(cell).toMatchObject({ prompt: '', code: 'x = 1', history: [], variables: [] })
      expect(needsGeneration(cell)).toBe(false)
    }
    const cell = fromIpynb({ nbformat: 4, cells: [{ cell_type: 'code', source: 'x = 1', metadata: 'oops' }] }).cells[0]
    expect(cell).toMatchObject({ kind: 'prompt', code: 'x = 1', outputs: [] })
  })

  it('skips cells and outputs that are not objects', () => {
    const nb = fromIpynb({ nbformat: 4, cells: [null, 3, { cell_type: 'code', source: ['x'], outputs: [null, 'x', { output_type: 'stream', text: 'hi' }] }] })
    expect(nb.cells).toHaveLength(1)
    expect((nb.cells[0] as PromptCell).outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'hi' }])
  })

  it('reads a malformed table with safe defaults', () => {
    const cell = read(
      {},
      {
        outputs: [
          {
            output_type: 'display_data',
            data: { [TABLE_MIME]: { columns: 'a', index: [0, 1], rows: [['a', { x: 1 }], 'bad', [true, null]], totalRows: 'many', profile: [null, { name: 'a', kind: 'text' }] } },
          },
        ],
      },
    )
    expect(cell.outputs).toEqual([
      { type: 'table', columns: [], index: ['0', '1'], rows: [['a', '{"x":1}'], [true, null]], totalRows: 2, profile: [{ name: 'a', kind: 'text' }] },
    ])
  })
})

describe('the record of how a cell was made', () => {
  const record: Provenance = {
    prompt: 'Average order value by plan',
    corrections: [{ from: 'total', to: 'total including tax' }],
    madeAt: '2026-09-30T12:00:00.000Z',
    model: 'anthropic/claude-sonnet-5.5',
    effort: 'medium',
    steps: [
      { step: 1, model: 'anthropic/claude-sonnet-5.5', fallback: false },
      { step: 2, model: 'anthropic/claude-opus-5', fallback: true },
    ],
    rationale: { from: 'summaries', text: ['Group by plan, then average.'] },
    attemptCount: 3,
    attempts: [
      { code: 'orders.amount.mean()', error: "KeyError: 'amount'", changed: null },
      { code: 'orders.totl.mean()', error: "AttributeError: 'DataFrame' object has no attribute 'totl'", changed: '- orders.amount.mean()\n+ orders.totl.mean()' },
      { code: 'orders.groupby("plan").total.mean()', error: null, changed: '- orders.totl.mean()\n+ orders.groupby("plan").total.mean()' },
    ],
    filesRead: [
      { path: 'data/orders.csv', by: 'code' },
      { path: 'README.md', by: 'agent' },
    ],
    filesReadTruncated: false,
    approvals: [{ kind: 'packages', detail: 'pip install seaborn', outcome: 'approved' }],
    codeHash: `sha256:${'a'.repeat(64)}`,
    outputsHash: `sha256:${'b'.repeat(64)}`,
  }
  const cell: PromptCell = { ...newPromptCell(record.prompt, 'orders.groupby("plan").total.mean()'), provenance: record }
  const saved = () => JSON.parse(JSON.stringify(toIpynb({ cells: [cell] })))
  const read = (provenance: unknown) =>
    (fromIpynb({ nbformat: 4, cells: [{ cell_type: 'code', source: ['x = 1'], metadata: { dalliance: { provenance } }, outputs: [] }] }).cells[0] as PromptCell).provenance

  it('saves only the final attempt, with the count of all of them', () => {
    const file = saved().cells[0].metadata.dalliance.provenance
    expect(file.attemptCount).toBe(3)
    // Only a step a fallback answered says so
    expect(file.steps).toEqual([
      { step: 1, model: 'anthropic/claude-sonnet-5.5' },
      { step: 2, model: 'anthropic/claude-opus-5', fallback: true },
    ])
    expect(file.attempts).toEqual([record.attempts[2]])
    expect(file).not.toHaveProperty('filesReadTruncated')
  })

  it('leaves out empty lists', () => {
    const bare = { ...record, corrections: [], attempts: [], filesRead: [], approvals: [], attemptCount: 0 }
    const file = toIpynb({ cells: [{ ...cell, provenance: bare }] }) as { cells: { metadata: { dalliance: { provenance: object } } }[] }
    expect(Object.keys(file.cells[0].metadata.dalliance.provenance)).toEqual(['prompt', 'madeAt', 'model', 'effort', 'steps', 'rationale', 'attemptCount', 'codeHash', 'outputsHash'])
  })

  it('reads back as saved, and saves the same again', () => {
    const first = saved()
    const back = fromIpynb(first).cells[0] as PromptCell
    expect(back.provenance).toEqual({ ...record, attempts: [record.attempts[2]] })
    expect(JSON.parse(JSON.stringify(toIpynb({ cells: [back] }))).cells[0].metadata.dalliance.provenance).toEqual(first.cells[0].metadata.dalliance.provenance)
  })

  it('is absent from cells without one, and from files saved before it existed', () => {
    const file = toIpynb({ cells: [newPromptCell('Plot it', 'x = 1')] }) as { cells: { metadata: { dalliance: object } }[] }
    expect(file.cells[0].metadata.dalliance).not.toHaveProperty('provenance')
    expect(read(undefined)).toBeNull()
  })

  it('reads a record that is not an object, or has no date, as none', () => {
    expect(read('made by the agent')).toBeNull()
    expect(read([record])).toBeNull()
    expect(read({ ...record, madeAt: 20260930 })).toBeNull()
  })

  it('reads mistyped fields as their defaults and drops malformed entries', () => {
    const back = read({
      madeAt: '2026-09-30',
      prompt: 7,
      corrections: [{ from: 'a' }, { from: 'a', to: 'b' }],
      steps: [{ step: '1' }, { step: 2 }, null],
      rationale: { from: 'dreams', text: ['kept', 3] },
      attempts: [{ error: 'no code' }, { code: 'x = 1', error: 5 }],
      filesRead: ['a.csv', { path: 'b.csv', by: 'someone' }],
      approvals: [{ kind: 'packages', detail: 'pip install x', outcome: 'maybe' }, { kind: 'shell', outcome: 'declined' }],
      filesReadTruncated: 'yes',
      codeHash: null,
    })
    expect(back).toEqual({
      prompt: '',
      corrections: [{ from: 'a', to: 'b' }],
      madeAt: '2026-09-30',
      model: null,
      effort: null,
      steps: [{ step: 2, model: null, fallback: false }],
      rationale: { from: 'none', text: ['kept'] },
      attemptCount: 1,
      attempts: [{ code: 'x = 1', error: null, changed: null }],
      filesRead: [{ path: 'b.csv', by: 'agent' }],
      filesReadTruncated: false,
      approvals: [{ kind: 'shell', detail: '', outcome: 'declined' }],
      codeHash: '',
      outputsHash: '',
    })
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
