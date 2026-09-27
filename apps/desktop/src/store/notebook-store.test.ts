import { beforeEach, describe, expect, it } from 'vitest'
import { type PromptCell, newNoteCell, newPromptCell } from '@ilios/shared/notebook'
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

    const removed = actions.deleteCell(id)!
    expect(useNotebook.getState().notebook.cells).toHaveLength(2)
    actions.restoreCell(removed.cell, removed.index)
    expect(useNotebook.getState().notebook.cells[2].id).toBe(id)
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
