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

/** A launch: read what the last run left, open a tab for each, and restore them in order. */
function relaunch(folder: string) {
  const drafts = new DraftStore(folder)
  const saved = drafts.read()
  const ids = saved.tabs.map((tab, i) => {
    drafts.open(`t${i + 1}`, tab)
    return `t${i + 1}`
  })
  drafts.arrange(ids, ids[saved.active] ?? null)
  return { drafts, ids, active: saved.active, restore: (i = 0) => drafts.restore(ids[i], false) }
}

/** One tab left open by the last run, restored. */
const restoreOne = (folder: string) => relaunch(folder).restore()

describe('DraftStore', () => {
  it('hands back the notebook exactly as it was after a reload of the tab', () => {
    const drafts = new DraftStore(dir())
    const nb = notebook('Total sales')
    drafts.open('t1')
    drafts.update('t1', { path: null, dirty: true, notebook: nb })
    expect(drafts.restore('t1', true)).toEqual({ path: null, dirty: true, notebook: nb, kernelKept: true })
  })

  it('gives a new tab the notebook it was opened with, on a kernel not started yet', () => {
    const drafts = new DraftStore(dir())
    const nb = notebook('Opened from Finder')
    drafts.open('t2')
    drafts.update('t2', { path: '/work/opened.ipynb', dirty: false, notebook: nb })
    expect(drafts.restore('t2', false)).toEqual({ path: '/work/opened.ipynb', dirty: false, notebook: nb, kernelKept: false })
    expect(drafts.restore('t3', false)).toBeNull()
  })

  it('brings back unsaved changes after a relaunch, marked out of date', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Total sales') })
    first.flush()

    const restored = restoreOne(folder) as RestoredSession | null
    expect(restored).toMatchObject({ path: null, dirty: true, kernelKept: false })
    expect(restored?.notebook.cells[0]).toMatchObject({ prompt: 'Total sales', state: 'stale' })
  })

  it('reopens a saved notebook from its file', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(toIpynb(notebook('Edited outside the app'))))
    const first = new DraftStore(folder)
    first.update('t1', { path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()

    const restored = restoreOne(folder) as RestoredSession | null
    expect(restored).toMatchObject({ path: file, dirty: false })
    expect(restored?.notebook.cells[0]).toMatchObject({ prompt: 'Edited outside the app' })
  })

  it('keeps a restored tab’s kernel through a reload after the relaunch', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(toIpynb(notebook('Saved'))))
    const first = new DraftStore(folder)
    first.update('t1', { path: file, dirty: false, notebook: notebook('Saved') })
    first.flush()

    const { drafts, ids } = relaunch(folder)
    expect(drafts.restore(ids[0], false)).toMatchObject({ path: file, kernelKept: false })
    expect(drafts.restore(ids[0], true)).toMatchObject({ path: file, kernelKept: true })
  })

  it('says why a notebook from a newer version of the app did not reopen', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(newer(notebook('From the future'))))
    const first = new DraftStore(folder)
    first.update('t1', { path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()

    expect(restoreOne(folder)).toEqual({
      path: file,
      error: "Couldn't reopen sales.ipynb. This notebook was saved by a newer version of Dalliance. Update the app to open it.",
    })
    // The file is untouched, so an updated app still opens it
    expect(restoreOne(folder)).toMatchObject({ path: file, error: expect.any(String) })
  })

  it('keeps unsaved changes from a newer version aside instead of dropping them', () => {
    const folder = dir()
    const ipynb = newer(notebook('Unsaved future work'))
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ version: 2, active: 0, tabs: [{ path: null, dirty: true, ipynb }] }))

    const restored = restoreOne(folder)
    expect(restored).toMatchObject({ path: null, error: expect.stringContaining('saved by a newer version of Dalliance') })
    const aside = readdirSync(folder).filter((f) => f.startsWith('session.json.unrestored-'))
    expect(aside).toHaveLength(1)
    expect(restored && 'error' in restored && restored.error).toContain(aside[0])
    expect(JSON.parse(readFileSync(path.join(folder, aside[0]), 'utf-8')).tabs[0].ipynb).toEqual(ipynb)
    // The next launch starts fresh rather than failing again
    expect(new DraftStore(folder).read()).toEqual({ tabs: [], active: 0 })
  })

  it('reports a saved file that is no longer a notebook', () => {
    const folder = dir()
    const file = path.join(folder, 'broken.ipynb')
    writeFileSync(file, '{"cells": ')
    const first = new DraftStore(folder)
    first.update('t1', { path: file, dirty: false, notebook: notebook('Old copy') })
    first.flush()
    expect(restoreOne(folder)).toMatchObject({ path: file, error: expect.stringMatching(/^Couldn't reopen broken\.ipynb\. /) })
  })

  it('starts fresh when the saved file is gone and nothing was unsaved', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: path.join(folder, 'deleted.ipynb'), dirty: false, notebook: notebook('Gone') })
    first.flush()
    expect(restoreOne(folder)).toBeNull()
  })

  it('forgets unsaved changes after Don’t Save', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Scratch work') })
    first.forgetChanges('t1')
    expect(new DraftStore(folder).read().tabs).toEqual([])
  })
})

describe('DraftStore with tabs', () => {
  it('brings back every tab in order, the one showing, and each one’s unsaved changes', () => {
    const folder = dir()
    const [a, b] = [path.join(folder, 'a.ipynb'), path.join(folder, 'b.ipynb')]
    writeFileSync(a, JSON.stringify(toIpynb(notebook('A on disk'))))
    writeFileSync(b, JSON.stringify(toIpynb(notebook('B on disk'))))
    const first = new DraftStore(folder)
    for (const id of ['t1', 't2', 't3', 't4']) first.open(id)
    first.update('t1', { path: a, dirty: false, notebook: notebook('A on disk') })
    first.update('t2', { path: b, dirty: true, notebook: notebook('B edited') })
    first.update('t3', { path: null, dirty: true, notebook: notebook('Scratch') })
    // t4 is on the start page, so there's nothing to bring back
    first.arrange(['t2', 't1', 't4', 't3'], 't3')
    first.flush()

    const { restore, ids, active } = relaunch(folder)
    expect(ids).toHaveLength(3)
    expect(active).toBe(2)
    expect(restore(0)).toMatchObject({ path: b, dirty: true, notebook: { cells: [{ prompt: 'B edited' }] } })
    expect(restore(1)).toMatchObject({ path: a, dirty: false, notebook: { cells: [{ prompt: 'A on disk' }] } })
    expect(restore(2)).toMatchObject({ path: null, dirty: true, notebook: { cells: [{ prompt: 'Scratch' }] } })
  })

  it('keeps a tab the page never sent a draft for, as the last run saved it', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Unsaved one') })
    first.update('t2', { path: null, dirty: true, notebook: notebook('Unsaved two') })
    first.flush()

    // The second launch writes before the second tab's page loaded
    const second = relaunch(folder)
    second.drafts.update(second.ids[0], { path: null, dirty: true, notebook: notebook('Unsaved one, more') })
    second.drafts.flush()

    const third = relaunch(folder)
    expect(third.restore(0)).toMatchObject({ notebook: { cells: [{ prompt: 'Unsaved one, more' }] } })
    expect(third.restore(1)).toMatchObject({ notebook: { cells: [{ prompt: 'Unsaved two' }] } })
  })

  it('forgets a closed tab, and Don’t Save on one tab leaves the others’ changes', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Closed') })
    first.update('t2', { path: null, dirty: true, notebook: notebook('Discarded') })
    first.update('t3', { path: null, dirty: true, notebook: notebook('Kept') })
    first.close('t1')
    first.forgetChanges('t2')

    const { restore, ids } = relaunch(folder)
    expect(ids).toHaveLength(1)
    expect(restore(0)).toMatchObject({ notebook: { cells: [{ prompt: 'Kept' }] } })
  })

  it('leaves session.json alone once the window closed and forgot its tabs', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Still here') })
    first.flush()
    first.clear()
    // Quitting afterwards flushes again, with nothing open
    first.flush()
    expect(relaunch(folder).restore()).toMatchObject({ notebook: { cells: [{ prompt: 'Still here' }] } })
  })

  it('keeps a closed tab closed when a save from it lands afterwards', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('Closed mid-save') })
    first.update('t2', { path: null, dirty: true, notebook: notebook('Kept') })
    first.close('t1')
    first.update('t1', { path: '/work/closed.ipynb', dirty: false, notebook: notebook('Closed mid-save') })
    first.flush()

    const { restore, ids } = relaunch(folder)
    expect(ids).toHaveLength(1)
    expect(restore(0)).toMatchObject({ notebook: { cells: [{ prompt: 'Kept' }] } })
  })

  it('keeps the last write when a save lands after the window closed', () => {
    const folder = dir()
    const first = new DraftStore(folder)
    first.update('t1', { path: null, dirty: true, notebook: notebook('One') })
    first.update('t2', { path: null, dirty: true, notebook: notebook('Two') })
    first.flush()
    first.clear()
    first.update('t1', { path: '/work/one.ipynb', dirty: false, notebook: notebook('One') })
    first.flush()

    const { restore, ids } = relaunch(folder)
    expect(ids).toHaveLength(2)
    expect(restore(1)).toMatchObject({ notebook: { cells: [{ prompt: 'Two' }] } })
  })

  it('reads a session.json from before tabs as one tab', () => {
    const folder = dir()
    const file = path.join(folder, 'sales.ipynb')
    writeFileSync(file, JSON.stringify(toIpynb(notebook('On disk'))))
    const ipynb = toIpynb(notebook('Unsaved in the old format'))
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ path: file, dirty: true, ipynb }))

    const { restore, ids, active, drafts } = relaunch(folder)
    expect(ids).toHaveLength(1)
    expect(active).toBe(0)
    expect(restore(0)).toMatchObject({ path: file, dirty: true, notebook: { cells: [{ prompt: 'Unsaved in the old format' }] } })
    // The next write is in the new format
    drafts.flush()
    expect(JSON.parse(readFileSync(path.join(folder, 'session.json'), 'utf-8'))).toMatchObject({ version: 2, active: 0, tabs: [{ path: file, dirty: true }] })
  })

  it('reads an old session.json with a clean notebook, and one with nothing in it', () => {
    const folder = dir()
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ path: '/work/sales.ipynb', dirty: false, ipynb: null }))
    expect(new DraftStore(folder).read()).toEqual({ tabs: [{ path: '/work/sales.ipynb', dirty: false, ipynb: null }], active: 0 })
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ path: null, dirty: false, ipynb: null }))
    expect(new DraftStore(folder).read()).toEqual({ tabs: [], active: 0 })
    writeFileSync(path.join(folder, 'session.json'), 'not json')
    expect(new DraftStore(folder).read()).toEqual({ tabs: [], active: 0 })
  })

  it('keeps the tab that was showing within range when the file says otherwise', () => {
    const folder = dir()
    const tab = { path: '/work/a.ipynb', dirty: false, ipynb: null }
    writeFileSync(path.join(folder, 'session.json'), JSON.stringify({ version: 2, active: 7, tabs: [tab, tab] }))
    expect(new DraftStore(folder).read().active).toBe(1)
  })
})
