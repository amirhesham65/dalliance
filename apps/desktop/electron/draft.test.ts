// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORMAT_VERSION, toIpynb } from '@dalliance/shared/ipynb'
import type { RestoredSession } from '@dalliance/shared/ipc'
import { type Notebook, newPromptCell } from '@dalliance/shared/notebook'
import { DraftStore } from './draft'

const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-draft-'))
const notebook = (prompt: string) => ({ cells: [{ ...newPromptCell(prompt, 'x = 1'), state: 'done' as const, executionCount: 1 }] })
/** The notebook as a later version of Dalliance, with a newer file format, would save it. */
const newer = (nb: Notebook) => {
  const ipynb = toIpynb(nb) as { metadata: Record<string, unknown> }
  return { ...ipynb, metadata: { ...ipynb.metadata, dalliance: { version: FORMAT_VERSION + 1 } } }
}

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

    const restored = new DraftStore(folder).restore() as RestoredSession | null
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

    const restored = new DraftStore(folder).restore() as RestoredSession | null
    expect(restored).toMatchObject({ path: file, dirty: false })
    expect(restored?.notebook.cells[0]).toMatchObject({ prompt: 'Edited outside the app' })
  })

  it('says why a notebook from a newer version of the app did not reopen', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(newer(notebook('From the future'))))
    const first = new DraftStore(folder)
    first.update({ path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()

    expect(new DraftStore(folder).restore()).toEqual({
      path: file,
      error: "Couldn't reopen sales.ipynb. This notebook was saved by a newer version of Dalliance. Update the app to open it.",
    })
    // The file is untouched, so an updated app still opens it
    expect(new DraftStore(folder).restore()).toMatchObject({ path: file, error: expect.any(String) })
  })

  it('keeps unsaved changes from a newer version aside instead of dropping them', () => {
    const folder = dir()
    const ipynb = newer(notebook('Unsaved future work'))
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ path: null, dirty: true, ipynb }))

    const restored = new DraftStore(folder).restore()
    expect(restored).toMatchObject({ path: null, error: expect.stringContaining('saved by a newer version of Dalliance') })
    const aside = readdirSync(folder).filter((f) => f.startsWith('session.json.unrestored-'))
    expect(aside).toHaveLength(1)
    expect(restored && 'error' in restored && restored.error).toContain(aside[0])
    expect(JSON.parse(readFileSync(path.join(folder, aside[0]), 'utf-8')).ipynb).toEqual(ipynb)
    // The next launch starts fresh rather than failing again
    expect(new DraftStore(folder).restore()).toBeNull()
  })

  it('reports a saved file that is no longer a notebook', () => {
    const folder = dir()
    const file = path.join(folder, 'broken.ipynb')
    writeFileSync(file, '{"cells": ')
    const first = new DraftStore(folder)
    first.update({ path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()
    expect(new DraftStore(folder).restore()).toMatchObject({ path: file, error: expect.stringMatching(/^Couldn't reopen broken\.ipynb\. /) })
  })

  it('starts fresh when the saved file is gone and nothing was unsaved', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update({ path: path.join(folder, 'deleted.ipynb'), dirty: false, notebook: notebook('Gone') })
    first.flush()
    expect(new DraftStore(folder).restore()).toBeNull()
  })

  it('forgets unsaved changes after Don’t Save', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update({ path: null, dirty: true, notebook: notebook('Scratch work') })
    first.forgetChanges()
    expect(new DraftStore(folder).restore()).toBeNull()
  })
})
