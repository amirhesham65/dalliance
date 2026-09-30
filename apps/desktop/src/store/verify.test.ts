import { beforeEach, describe, expect, it } from 'vitest'
import { type Output, type PromptCell, newNoteCell, newPromptCell } from '@dalliance/shared/notebook'
import { fakeApi, result } from '@/test/fake-api'
import { actions, setApi, useNotebook } from './notebook-store'

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}
const cell = (i: number) => useNotebook.getState().notebook.cells.filter((c) => c.kind === 'prompt')[i] as PromptCell
const text = (t: string): Output[] => [{ type: 'text', text: t }]
const report = () => useNotebook.getState().verify!
const statuses = () => report().cells.map((c) => c.status)

/** A prompt cell that ran and was saved with `output`. */
const ran = (prompt: string, code: string, output: string, extra: Partial<PromptCell> = {}): PromptCell => ({
  ...newPromptCell(prompt, code),
  generatedFrom: prompt,
  state: 'done',
  executionCount: 1,
  outputs: text(output),
  ...extra,
})

function load(...cells: Parameters<typeof actions.load>[0]['cells']) {
  actions.load({ cells }, null)
}

beforeEach(() => setApi(undefined))

describe('verify', () => {
  it('asks first, and does nothing until confirmed', () => {
    const { api, requests } = fakeApi(() => result())
    setApi(api)
    load(ran('a', 'a = 1\na', '1'))
    actions.askVerify()
    expect(useNotebook.getState().verifyAsking).toBe(true)
    actions.cancelVerify()
    expect(useNotebook.getState()).toMatchObject({ verifyAsking: false, verify: null })
    expect(requests).toEqual([])
  })

  it("restarts the tab's kernel once and reruns every cell's saved code top to bottom, without the model", async () => {
    const outputs: Record<string, string> = { 'a = 1\na': '1', 'b = a + 1\nb': '3' }
    const { api, requests } = fakeApi((req) =>
      req.code === 'boom()'
        ? result({ ok: false, generated: false, code: req.code, outputs: [{ type: 'error', ename: 'ValueError', evalue: 'no', traceback: [] }] })
        : result({ generated: false, code: req.code, outputs: text(outputs[req.code]), executionCount: requests.length }),
    )
    let restarts = 0
    api.restartKernel = async () => void restarts++
    setApi(api)
    // The second cell's prompt changed since its code was written, which would normally regenerate it
    load(newNoteCell('# Notes'), ran('a', 'a = 1\na', '1'), ran('b', 'b = a + 1\nb', '2', { prompt: 'b, but bigger' }), ran('c', 'boom()', 'fine'), {
      ...newPromptCell('A question answered in words'),
      answer: 'Yes.',
      state: 'done',
    })
    const before = [0, 1, 2, 3].map(cell)
    await actions.verify()
    await settle()

    expect(restarts).toBe(1)
    expect(requests.map((r) => [r.code, r.generate, r.nameIt])).toEqual([
      ['a = 1\na', false, false],
      ['b = a + 1\nb', false, false],
      ['boom()', false, false],
    ])
    expect(report().phase).toBe('done')
    expect(statuses()).toEqual(['same', 'changed', 'failed', 'no-code'])
    expect(report().cells[1]).toMatchObject({ saved: text('2'), fresh: text('3') })
    // The saved outputs and everything else about the cells stay as they were
    before.forEach((was, i) => {
      const now = cell(i)
      expect(now.outputs).toBe(was.outputs)
      expect([now.code, now.prompt, now.answer, now.history, now.provenance]).toEqual([was.code, was.prompt, was.answer, was.history, was.provenance])
    })
    // A cell that came back the same is up to date again. The others stay out of date after the restart
    expect(cell(0)).toMatchObject({ state: 'done', executionCount: 1 })
    expect([cell(1).state, cell(2).state]).toEqual(['stale', 'stale'])
    expect(useNotebook.getState().log[0]).toMatchObject({ kind: 'verified', text: 'Verified 3 cells: 1 the same, 1 changed, 1 failed.' })
  })

  it('calls a figure that differs just that, and a byte for byte one the same', async () => {
    const png = (data: string): Output => ({ type: 'image', mime: 'image/png', data })
    const { api } = fakeApi((req) => result({ generated: false, code: req.code, outputs: [png(req.code === 'plot1' ? 'AAAA' : 'CCCC')] }))
    setApi(api)
    load(ran('p1', 'plot1', '', { outputs: [png('AAAA')] }), ran('p2', 'plot2', '', { outputs: [png('BBBB')] }))
    await actions.verify()
    await settle()
    expect(statuses()).toEqual(['same', 'figure'])
  })

  it('stops mid-verify through Stop, and keeps the report as far as it got', async () => {
    let release!: () => void
    const { api, requests } = fakeApi((req) =>
      req.code === 'slow()'
        ? new Promise((resolve) => {
            release = () => resolve(result({ ok: false, generated: false, code: req.code, outputs: [{ type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: [] }] }))
          })
        : result({ generated: false, code: req.code, outputs: text('1') }),
    )
    let interrupts = 0
    api.interrupt = async () => void interrupts++
    setApi(api)
    load(ran('a', 'a = 1\na', '1'), ran('slow', 'slow()', 'done'), ran('c', 'c = 3', '3'))
    await actions.verify()
    await settle()
    expect(statuses()).toEqual(['same', 'waiting', 'waiting'])
    expect(useNotebook.getState().runs[cell(1).id]?.status).toBe('running')

    const before = interrupts
    await actions.interrupt()
    expect(interrupts).toBe(before + 1)
    expect(report().phase).toBe('stopping')
    release()
    await settle()
    expect(report().phase).toBe('stopped')
    expect(statuses()).toEqual(['same', 'stopped', 'not-run'])
    expect(requests.map((r) => r.code)).toEqual(['a = 1\na', 'slow()'])
    expect(useNotebook.getState().runs).toEqual({})
    expect(useNotebook.getState().log[0].text).toBe('Stopped verifying after 2 of 3 cells: 1 the same, 1 stopped.')
  })

  it('runs nothing when stopped while Python restarts', async () => {
    let restarted!: () => void
    const { api, requests } = fakeApi((req) => result({ generated: false, code: req.code }))
    api.restartKernel = () => new Promise((resolve) => (restarted = resolve))
    setApi(api)
    load(ran('a', 'a = 1\na', '1'))
    const verifying = actions.verify()
    await flush()
    expect(report().phase).toBe('restarting')
    await actions.interrupt()
    restarted()
    await verifying
    await settle()
    expect(report().phase).toBe('stopped')
    expect(statuses()).toEqual(['not-run'])
    expect(requests).toEqual([])
  })

  it('says why when Python does not restart', async () => {
    const { api, requests } = fakeApi(() => result())
    api.restartKernel = async () => {
      throw new Error('No Python found.')
    }
    setApi(api)
    load(ran('a', 'a = 1\na', '1'))
    await actions.verify()
    await settle()
    expect(report()).toMatchObject({ phase: 'failed', error: 'No Python found.' })
    expect(statuses()).toEqual(['not-run'])
    expect(requests).toEqual([])
  })

  it('says when a cell only worked thanks to a name the agent made while exploring', async () => {
    const { api } = fakeApi((req) =>
      req.code.startsWith('cohort')
        ? result({ ok: false, generated: false, code: req.code, outputs: [{ type: 'error', ename: 'NameError', evalue: "name 'cohort' is not defined", traceback: [] }] })
        : result({ generated: false, code: req.code, outputs: text('412') }),
    )
    setApi(api)
    load(ran('Load', 'patients = load()\nlen(patients)', '412'), ran('Describe the cohort', 'cohort.describe()', 'table'))
    // The agent's explore step made `cohort` while it wrote the first cell, in this session
    useNotebook.setState({ activity: { [cell(0).id]: [{ id: 'e1', label: 'Picking the older patients', code: 'cohort = patients[patients.age > 65]', status: 'done' }] } })
    await actions.verify()
    await settle()
    expect(report().cells[1]).toMatchObject({ status: 'failed', missing: { name: 'cohort', cause: { kind: 'agent', cell: 1 } } })
  })

  it('warns about random calls with no seed, read from the code', async () => {
    const { api } = fakeApi((req) => result({ generated: false, code: req.code, outputs: text('1') }))
    setApi(api)
    load(ran('Imports', 'import numpy as np', ''), ran('Sample', 'ids = np.random.choice(100, 5)\nids', '1'))
    await actions.verify()
    expect(report().cells.map((c) => c.seeds.map((w) => w.call))).toEqual([[], ['np.random.choice']])
  })

  it('keeps the new outputs only when asked, and Undo puts the saved ones back', async () => {
    const { api } = fakeApi((req) => result({ generated: false, code: req.code, outputs: text('3'), executionCount: 7 }))
    setApi(api)
    load(ran('b', 'b = 3\nb', '2'))
    const saved = cell(0).outputs
    await actions.verify()
    await settle()
    expect(cell(0).outputs).toBe(saved)

    actions.keepVerified(cell(0).id)
    expect(cell(0)).toMatchObject({ outputs: text('3'), executionCount: 7, state: 'done' })
    expect(useNotebook.getState().notice?.text).toBe('Kept the new outputs of cell 1')
    actions.undo()
    expect(cell(0).outputs).toBe(saved)
  })

  it('reports a cell deleted while it waits as not run, and still finishes', async () => {
    let release!: () => void
    const { api } = fakeApi((req) =>
      req.code === 'slow()' ? new Promise((resolve) => (release = () => resolve(result({ generated: false, code: req.code, outputs: text('done') })))) : result({ generated: false, code: req.code, outputs: text('3') }),
    )
    setApi(api)
    load(ran('slow', 'slow()', 'done'), ran('c', 'c = 3', '3'))
    await actions.verify()
    await settle()
    actions.deleteCell(cell(1).id)
    release()
    await settle()
    expect(report().phase).toBe('done')
    expect(statuses()).toEqual(['same', 'not-run'])
  })

  it('drops the report when another notebook loads mid-verify', async () => {
    let release!: () => void
    const { api } = fakeApi((req) => new Promise((resolve) => (release = () => resolve(result({ generated: false, code: req.code })))))
    setApi(api)
    const same = ran('a', 'a = 1\na', '1')
    load(same)
    await actions.verify()
    await settle()
    load({ ...same })
    release()
    await settle()
    expect(useNotebook.getState().verify).toBeNull()
    expect(cell(0)).toMatchObject({ outputs: same.outputs, state: 'done' })
  })
})
