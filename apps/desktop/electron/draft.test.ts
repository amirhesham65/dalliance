// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { toIpynb } from '@dalliance/shared/ipynb'
import { newPromptCell } from '@dalliance/shared/notebook'
import { DraftStore } from './draft'

const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-draft-'))
const notebook = (prompt: string) => ({ cells: [{ ...newPromptCell(prompt, 'x = 1'), state: 'done' as const, executionCount: 1 }] })

describe('DraftStore', () => {
  it('hands back the notebook exactly as it was after a window reload', () => {
    const drafts = new DraftStore(dir())
    const nb = notebook('Total sales')
    drafts.update({ path: null, dirty: true, notebook: nb })
    expect(drafts.restore()).toEqual({ path: null, dirty: true, notebook: nb, kernelKept: true })
  })

  it('brings back unsaved changes after a relaunch, marked out of date', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update({ path: null, dirty: true, notebook: notebook('Total sales') })
    first.flush()

    const restored = new DraftStore(folder).restore()
    expect(restored).toMatchObject({ path: null, dirty: true, kernelKept: false })
    expect(restored?.notebook.cells[0]).toMatchObject({ prompt: 'Total sales', state: 'stale' })
  })

  it('reopens a saved notebook from its file', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(toIpynb(notebook('Edited outside the app'))))
    const first = new DraftStore(folder)
    first.update({ path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()

    const restored = new DraftStore(folder).restore()
    expect(restored).toMatchObject({ path: file, dirty: false })
    expect(restored?.notebook.cells[0]).toMatchObject({ prompt: 'Edited outside the app' })
  })

  it('forgets unsaved changes after Don’t Save', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update({ path: null, dirty: true, notebook: notebook('Scratch work') })
    first.forgetChanges()
    expect(new DraftStore(folder).restore()).toBeNull()
  })
})
