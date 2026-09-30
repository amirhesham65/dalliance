import { beforeEach, describe, expect, it } from 'vitest'
import { type PromptCell, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { fakeApi, result } from '@/test/fake-api'
import { actions, setApi, useNotebook } from './notebook-store'

const flush = () => new Promise((r) => setTimeout(r, 0))
const cell = (i: number) => useNotebook.getState().notebook.cells[i] as PromptCell

function load(...cells: Parameters<typeof actions.load>[0]['cells']) {
  actions.load({ cells }, null)
}

beforeEach(() => setApi(undefined))

describe('running cells', () => {
  it('generates code for a new prompt and stores the result', async () => {
    const { api, requests } = fakeApi(() => result({ interpretation: 'Read as [[this]].', answer: 'It is 1.' }))
    setApi(api)
    load(newPromptCell('What is x?'))
    actions.run(cell(0).id)
    await flush()

    expect(requests[0]).toMatchObject({ prompt: 'What is x?', generate: true, previousCells: [] })
    expect(cell(0)).toMatchObject({
      code: 'x = 1\nx',
      generatedFrom: 'What is x?',
      executionCount: 1,
      state: 'done',
      interpretation: 'Read as [[this]].',
      answer: 'It is 1.',
    })
    expect(useNotebook.getState().runs).toEqual({})
    expect(useNotebook.getState().dirty).toBe(true)
  })

  it('reruns unchanged code without generating, and regenerates after an edit', async () => {
    const { api, requests } = fakeApi((req) => result({ generated: req.generate, code: req.generate ? 'y = 2' : req.code }))
    setApi(api)
    load({ ...newPromptCell('Make y', 'y = 2'), executionCount: 1, state: 'done' })

    actions.run(cell(0).id)
    await flush()
    expect(requests[0].generate).toBe(false)

    actions.setPrompt(cell(0).id, 'Make y twice as big')
    expect(cell(0).state).toBe('edited')
    actions.run(cell(0).id)
    await flush()
    expect(requests[1].generate).toBe(true)
  })

  it('runs queued cells one at a time, in order, with earlier cells as context', async () => {
    const order: string[] = []
    const { api, requests } = fakeApi(async (req) => {
      order.push(`start ${req.prompt}`)
      await flush()
      order.push(`end ${req.prompt}`)
      return result()
    })
    setApi(api)
    load(newNoteCell('# Intro'), newPromptCell('first'), newPromptCell('second'))
    actions.runAll()
    await flush()
    await flush()
    await flush()

    expect(order).toEqual(['start first', 'end first', 'start second', 'end second'])
    expect(requests[1].previousCells).toEqual([
      { kind: 'note', text: '# Intro' },
      { kind: 'prompt', text: 'first', code: 'x = 1\nx' },
    ])
  })

  it('marks later cells out of date when an earlier cell reruns', async () => {
    const { api } = fakeApi(() => result())
    setApi(api)
    load({ ...newPromptCell('a', 'a = 1'), state: 'done', executionCount: 1 }, { ...newPromptCell('b', 'b = a'), state: 'done', executionCount: 2 })
    actions.run(cell(0).id)
    await flush()
    expect(cell(1).state).toBe('stale')
  })

  it('keeps the cell unchanged and shows the message when nothing could run', async () => {
    const { api } = fakeApi(() => result({ ok: false, outputs: [], executionCount: null, error: 'Add an AI Gateway key in Settings to run prompts.' }))
    setApi(api)
    load(newPromptCell('Plot sales'))
    actions.run(cell(0).id)
    await flush()
    expect(cell(0)).toMatchObject({ code: '', state: 'idle' })
    expect(useNotebook.getState().messages[cell(0).id]).toContain('AI Gateway key')
  })

  it('keeps a prompt edited during the run, and regenerates it next time', async () => {
    let release!: () => void
    const { api, requests } = fakeApi((req) => new Promise((resolve) => (release = () => resolve(result({ code: `# for ${req.prompt}` })))))
    setApi(api)
    load(newPromptCell('Revenue by month'))
    actions.run(cell(0).id)
    await flush()
    actions.setPrompt(cell(0).id, 'Revenue by week')
    release()
    await flush()

    expect(cell(0)).toMatchObject({ prompt: 'Revenue by week', code: '# for Revenue by month', generatedFrom: 'Revenue by month', state: 'edited' })
    // History has the version that ran
    expect(cell(0).history[0]).toMatchObject({ prompt: 'Revenue by month', code: '# for Revenue by month' })
    actions.run(cell(0).id)
    await flush()
    release()
    await flush()
    expect(requests[1]).toMatchObject({ prompt: 'Revenue by week', generate: true })
    expect(cell(0)).toMatchObject({ generatedFrom: 'Revenue by week', state: 'done' })
  })

  it('keeps code edited during the run, and runs it next time', async () => {
    let release!: () => void
    const { api, requests } = fakeApi((req) => new Promise((resolve) => (release = () => resolve(result({ code: req.generate ? 'agent = 1' : req.code })))))
    setApi(api)
    load(newPromptCell('Make a number'))
    actions.run(cell(0).id)
    await flush()
    actions.setCode(cell(0).id, 'mine = 2')
    release()
    await flush()

    expect(cell(0)).toMatchObject({ code: 'mine = 2', codeEdited: true, generatedFrom: 'Make a number', state: 'edited' })
    actions.run(cell(0).id)
    await flush()
    release()
    await flush()
    expect(requests[1]).toMatchObject({ code: 'mine = 2', generate: false })
    expect(cell(0)).toMatchObject({ code: 'mine = 2', state: 'done' })
  })

  it('shows live progress from run events', async () => {
    let release!: () => void
    const { api } = fakeApi(
      (_req, emit) =>
        new Promise((resolve) => {
          emit({ type: 'status', text: 'Checking variables' })
          emit({ type: 'activity', item: { id: 't1', label: 'Checked variables', status: 'done' } })
          emit({ type: 'attempt', code: 'x' })
          emit({ type: 'output', output: { type: 'text', text: 'live' } })
          emit({ type: 'question', requestId: 'r1', question: 'Which table?', options: ['orders', 'refunds'] })
          release = () => resolve(result())
        }),
    )
    setApi(api)
    const off = api.onRunEvent((id, e) => actions.applyRunEvent(id, e))
    load(newPromptCell('Sum it'))
    actions.run(cell(0).id)
    await flush()

    const run = useNotebook.getState().runs[cell(0).id]
    expect(run).toMatchObject({ status: 'running', statusText: 'Checking variables', liveCode: 'x', liveOutputs: [{ type: 'text', text: 'live' }] })
    expect(run.question?.options).toEqual(['orders', 'refunds'])

    actions.answer(cell(0).id, 'r1', 'orders')
    expect(useNotebook.getState().runs[cell(0).id].question).toBeNull()
    release()
    await flush()
    off()
  })
})

describe('editing the notebook', () => {
  it('inserts, moves, deletes and restores cells', () => {
    load(newPromptCell('a'), newPromptCell('b'))
    const id = actions.insertCell(1, 'note')
    expect(useNotebook.getState().notebook.cells.map((c) => c.kind)).toEqual(['prompt', 'note', 'prompt'])
    expect(useNotebook.getState().selectedId).toBe(id)

    actions.moveCell(id, 1)
    expect(useNotebook.getState().notebook.cells[2].id).toBe(id)

    actions.deleteCell(id)
    expect(useNotebook.getState().notebook.cells).toHaveLength(2)
    expect(actions.undo()).toBe(true)
    expect(useNotebook.getState().notebook.cells[2].id).toBe(id)
  })
})

describe('undo and redo', () => {
  const ids = () => useNotebook.getState().notebook.cells.map((c) => c.id)

  it('takes back inserts, moves and deletes in order, and redoes them', () => {
    load(newPromptCell('a'), newPromptCell('b'))
    const [a, b] = ids()
    const note = actions.insertCell(1, 'note')
    actions.setNote(note, 'Typed after inserting')
    actions.moveCell(a, 1)
    actions.deleteCell(b)
    expect(ids()).toEqual([note, a])

    actions.undo()
    expect(ids()).toEqual([note, a, b])
    actions.undo()
    expect(ids()).toEqual([a, note, b])
    actions.undo()
    expect(ids()).toEqual([a, b])
    expect(actions.undo()).toBe(false)

    actions.redo()
    // The inserted cell comes back with what was typed into it
    expect(useNotebook.getState().notebook.cells[1]).toMatchObject({ id: note, markdown: 'Typed after inserting' })
    actions.redo()
    actions.redo()
    expect(ids()).toEqual([note, a])
    expect(actions.redo()).toBe(false)
  })

  it('switches a cell back from a note and forward again', () => {
    const original = { ...newPromptCell('Sum', 's = 1'), outputs: [{ type: 'text' as const, text: '1' }], state: 'done' as const, executionCount: 1 }
    load(original)
    actions.setKind(original.id, 'note')
    actions.undo()
    expect(cell(0)).toEqual(original)
    actions.redo()
    expect(useNotebook.getState().notebook.cells[0]).toMatchObject({ kind: 'note', markdown: 'Sum' })
  })

  it('undoes a correction and a restored revision without touching the outputs', () => {
    const rev = { at: 1, prompt: 'Churn', code: 'c = 0', interpretation: null, answer: null, edited: false }
    const outputs = [{ type: 'text' as const, text: '0.2' }]
    load({ ...newPromptCell('Churn rate', 'c = 1'), interpretation: 'Churned means [[cancelled]].', history: [rev], outputs, state: 'done', executionCount: 1 })
    const id = cell(0).id
    actions.correctAssumption(id, 'cancelled', 'gone')
    actions.restoreRevision(id, 1)
    expect(cell(0)).toMatchObject({ prompt: 'Churn', code: 'c = 0', interpretation: null })

    actions.undo()
    expect(cell(0)).toMatchObject({ prompt: 'Churn rate', code: 'c = 1', interpretation: 'Churned means [[gone]].' })
    actions.undo()
    expect(cell(0)).toMatchObject({ interpretation: 'Churned means [[cancelled]].', corrections: [], state: 'done' })
    expect(cell(0).outputs).toBe(outputs)
    actions.redo()
    expect(cell(0)).toMatchObject({ interpretation: 'Churned means [[gone]].', corrections: [{ from: 'cancelled', to: 'gone' }] })
  })

  it('never rolls back a run: an edit the run replaced is dropped', async () => {
    setApi(fakeApi(() => result({ interpretation: 'Churned means [[gone for good]].' })).api)
    load({ ...newPromptCell('Churn', 'c = 1'), interpretation: 'Churned means [[cancelled]].', state: 'done', executionCount: 1 })
    const id = cell(0).id
    actions.correctAssumption(id, 'cancelled', 'gone')
    actions.run(id)
    await flush()
    expect(cell(0).interpretation).toBe('Churned means [[gone for good]].')
    expect(actions.undo()).toBe(false)
    expect(cell(0).interpretation).toBe('Churned means [[gone for good]].')
  })

  it('keeps the last 100 edits and forgets them all when another notebook loads', () => {
    load(newPromptCell('a'), newPromptCell('b'))
    const [a] = ids()
    for (let i = 0; i < 105; i++) actions.moveCell(a, i % 2 ? -1 : 1)
    let undone = 0
    while (actions.undo()) undone++
    expect(undone).toBe(100)

    actions.moveCell(a, 1)
    load(newPromptCell('c'))
    expect(actions.undo()).toBe(false)
  })

  it('points the notice for a deleted cell at the same stack', () => {
    load(newPromptCell('a'), newPromptCell('b'))
    const [a, b] = ids()
    actions.deleteCell(a)
    const notice = useNotebook.getState().notice!
    expect(notice.text).toBe('Cell deleted')
    // Cmd+Z took it back, so the notice goes and its Undo can't take back anything else
    actions.undo()
    expect(useNotebook.getState().notice).toBeNull()
    actions.moveCell(b, -1)
    notice.undo!()
    expect(ids()).toEqual([b, a])
  })
})

describe('results that arrive late', () => {
  it('drops the result of a cell deleted while it ran, even after Undo brings it back', async () => {
    let release!: () => void
    const { api } = fakeApi(() => new Promise((resolve) => (release = () => resolve(result({ outputs: [{ type: 'text', text: 'late' }] })))))
    let interrupts = 0
    api.interrupt = async () => void interrupts++
    setApi(api)
    load(newPromptCell('Slow'))
    const id = cell(0).id
    actions.run(id)
    await flush()
    actions.deleteCell(id)
    expect(interrupts).toBe(1)
    actions.undo()
    release()
    await flush()
    expect(cell(0)).toMatchObject({ id, outputs: [], executionCount: null })
    expect(useNotebook.getState().runs).toEqual({})
    expect(useNotebook.getState().log).toEqual([])
  })

  it('ignores a title for a cell that is gone', () => {
    load(newPromptCell('a'))
    useNotebook.setState({ dirty: false })
    actions.applyRunEvent('no-such-cell', { type: 'title', title: 'Ghost', prompt: 'a' })
    expect(useNotebook.getState().dirty).toBe(false)
  })

  it('stops the running cell and drops its result when another notebook loads', async () => {
    let release!: () => void
    const { api } = fakeApi(() => new Promise((resolve) => (release = () => resolve(result()))))
    let interrupts = 0
    api.interrupt = async () => void interrupts++
    setApi(api)
    const same = newPromptCell('Slow')
    load(same, newPromptCell('Queued'))
    actions.runAll()
    await flush()
    // Reopening the same file brings back cells with the same ids
    load({ ...same })
    expect(interrupts).toBe(1)
    release()
    await flush()
    expect(cell(0)).toMatchObject({ outputs: [], executionCount: null, state: 'idle' })
    expect(useNotebook.getState()).toMatchObject({ runs: {}, messages: {}, log: [], dirty: false })
  })

  it('makes an empty prompt cell a note at once, and offers Undo only when something would be lost', () => {
    load(newPromptCell('Just an idea'), { ...newPromptCell('Sum', 's = 1'), outputs: [{ type: 'text', text: '1' }], state: 'done', executionCount: 1 })
    actions.setKind(cell(0).id, 'note')
    expect(useNotebook.getState().notebook.cells[0]).toMatchObject({ kind: 'note', markdown: 'Just an idea' })
    expect(useNotebook.getState().notice).toBeNull()

    const before = cell(1)
    actions.setKind(before.id, 'note')
    const notice = useNotebook.getState().notice!
    expect(notice.text).toBe('Made the cell a note')
    notice.undo!()
    expect(cell(1)).toEqual(before)
  })

  it('records a corrected assumption for the next run', () => {
    load({ ...newPromptCell('Churn', 'c = 1'), interpretation: 'Churned means [[cancelled]].', state: 'done', executionCount: 1 })
    actions.correctAssumption(cell(0).id, 'cancelled', 'cancelled and not reactivated')
    expect(cell(0)).toMatchObject({
      interpretation: 'Churned means [[cancelled and not reactivated]].',
      corrections: [{ from: 'cancelled', to: 'cancelled and not reactivated' }],
      state: 'edited',
    })
  })

  it('marks everything out of date after a kernel restart', async () => {
    const { api } = fakeApi(() => result())
    setApi(api)
    load({ ...newPromptCell('a', 'a = 1'), state: 'done', executionCount: 4 })
    await actions.restart()
    expect(cell(0)).toMatchObject({ state: 'stale', executionCount: null })
  })
})
