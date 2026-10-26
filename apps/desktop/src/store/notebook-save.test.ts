import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DallianceApi, SavedNotebook } from '@dalliance/shared/ipc'
import { newPromptCell } from '@dalliance/shared/notebook'
import { fakeApi, result } from '@/test/fake-api'
import { actions, setApi, useNotebook } from './notebook-store'
import { renameNotebook, saveNotebook, startAutoSave } from './notebook-save'

let stop: (() => void) | undefined
const state = useNotebook.getState
const edit = (text: string) => actions.setPrompt(state().notebook.cells[0].id, text)

beforeEach(() => {
  vi.useFakeTimers()
  actions.load({ cells: [newPromptCell('Original')] }, '/work/Trial.ipynb')
})

afterEach(() => {
  stop?.()
  stop = undefined
  setApi(undefined)
  vi.useRealTimers()
})

function setup() {
  const { api } = fakeApi(() => result())
  const save = vi.fn<DallianceApi['saveNotebook']>(async (path, notebook) => ({ path: path!, pins: notebook.pins ?? null }))
  api.saveNotebook = save
  setApi(api)
  stop = startAutoSave()
  return { api, save }
}

describe('notebook auto-save', () => {
  it('saves the latest edit after a one-second pause and leaves clean notebooks alone', async () => {
    const { save } = setup()
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
    edit('First edit')
    await vi.advanceTimersByTimeAsync(700)
    edit('Latest edit')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()
    // Live activity and selection do not delay saving.
    actions.select(state().notebook.cells[0].id)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('/work/Trial.ipynb', expect.objectContaining({ cells: [expect.objectContaining({ prompt: 'Latest edit' })] }), { autoSave: true })
    expect(state().dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not open a Save dialog for a notebook without a path', async () => {
    const { save } = setup()
    actions.load({ cells: [newPromptCell('Recovered draft')] }, null, true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
    expect(state().dirty).toBe(true)
  })

  it('saves recovered edits and completed run results', async () => {
    const { save } = setup()
    actions.load({ cells: [newPromptCell('Recovered draft')] }, '/work/Trial.ipynb', true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    actions.run(state().notebook.cells[0].id)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1].cells[0]).toMatchObject({ code: 'x = 1\nx', state: 'done' })
    expect(state().dirty).toBe(false)
  })

  it('keeps edits made during a save dirty, then saves them without overlapping writes', async () => {
    const { save } = setup()
    let finish!: (saved: SavedNotebook) => void
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    edit('Snapshot')
    await vi.advanceTimersByTimeAsync(1000)
    edit('Typed while saving')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    finish({ path: '/work/Trial.ipynb', pins: null })
    // Observe the old save completing before the queued one starts.
    await Promise.resolve()
    expect(state().dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1].cells[0]).toMatchObject({ prompt: 'Typed while saving' })
    expect(state().dirty).toBe(false)
  })

  it('cancels a pending save when another notebook loads', async () => {
    const { save } = setup()
    edit('Old edit')
    await vi.advanceTimersByTimeAsync(500)
    actions.load({ cells: [newPromptCell('Another notebook')] }, '/work/Other.ipynb')
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
  })

  it('ignores a late save even when the same file is reopened', async () => {
    const { save } = setup()
    let finish!: (saved: SavedNotebook) => void
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    edit('Old edit')
    await vi.advanceTimersByTimeAsync(1000)
    actions.load({ cells: [newPromptCell('Reopened')] }, '/work/Trial.ipynb')
    edit('New session edit')
    finish({ path: '/work/Trial.ipynb', pins: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(state().dirty).toBe(true)
    expect(state().notebook.cells[0]).toMatchObject({ prompt: 'New session edit' })
  })

  it('reports failures without clearing dirty or repeatedly retrying an unchanged document', async () => {
    const { save } = setup()
    save.mockRejectedValue(new Error('Disk is full'))
    edit('Keep this')
    await vi.advanceTimersByTimeAsync(1000)
    expect(state().dirty).toBe(true)
    expect(state().notice?.text).toContain("Couldn't auto-save the notebook. Disk is full")
    await vi.advanceTimersByTimeAsync(10000)
    expect(save).toHaveBeenCalledTimes(1)
    save.mockResolvedValue({ path: '/work/Trial.ipynb', pins: null })
    await saveNotebook()
    expect(state().dirty).toBe(false)
  })

  it('queues Save As behind auto-save and sends later edits to the new path', async () => {
    const { save } = setup()
    let finish!: (saved: SavedNotebook) => void
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    edit('Snapshot')
    await vi.advanceTimersByTimeAsync(1000)
    save.mockResolvedValue({ path: '/copy/Trial.ipynb', pins: null })
    const saveAs = saveNotebook(true)
    finish({ path: '/work/Trial.ipynb', pins: null })
    await saveAs
    expect(save.mock.calls[1][0]).toBeNull()
    expect(state().path).toBe('/copy/Trial.ipynb')
    edit('After Save As')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save.mock.calls[2][0]).toBe('/copy/Trial.ipynb')
  })

  it('queues a rename behind an active save and writes subsequent edits under the new name', async () => {
    const { api, save } = setup()
    let finish!: (saved: SavedNotebook) => void
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const rename = vi.spyOn(api, 'renameNotebook').mockResolvedValue({ path: '/work/Renamed.ipynb', saved: false })
    edit('Before rename')
    await vi.advanceTimersByTimeAsync(1000)
    const renaming = renameNotebook('Renamed')
    expect(rename).not.toHaveBeenCalled()
    finish({ path: '/work/Trial.ipynb', pins: null })
    await renaming
    expect(rename.mock.calls[0][0]).toBe('/work/Trial.ipynb')
    expect(state().path).toBe('/work/Renamed.ipynb')
    edit('After rename')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save.mock.calls[1][0]).toBe('/work/Renamed.ipynb')
  })

  it('stops scheduling when the watcher is disposed', async () => {
    const { save } = setup()
    edit('Pending')
    stop?.()
    edit('After unmount')
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
  })
})
