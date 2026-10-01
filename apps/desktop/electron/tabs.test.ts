// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type CloseChoice, type Tab, Tabs, tabTitle } from './tabs'

interface View {
  id: string
  attached: boolean
  focused: boolean
  destroyed: boolean
}
interface Session {
  id: string
  shutdown: boolean
}
type T = Tab<View, Session>

/**
 * Tabs over fake views and sessions. `answers` are the close dialog's choices, in order. `saves` says whether each
 * requested save lands: the fake page answers the way the renderer's saveNotebook() does, through finishSave().
 */
function setup({ answers = [] as CloseChoice[], saves = [] as boolean[], onAsk = (_tab: T) => {} } = {}) {
  const log: string[] = []
  let windowClosed = 0
  const views: View[] = []
  const tabs: Tabs<View, Session> = new Tabs<View, Session>({
    createView: (id) => {
      const view = { id, attached: false, focused: false, destroyed: false }
      views.push(view)
      return view
    },
    createSession: (id) => ({ id, shutdown: false }),
    show: (view) => {
      for (const v of views) v.focused = false
      view.attached = true
      view.focused = true
    },
    hide: (view) => {
      view.attached = false
      view.focused = false
    },
    dispose: (tab) => {
      tab.view.destroyed = true
      tab.session.shutdown = true
      log.push(`dispose ${tab.id}`)
    },
    askToSave: async (tab) => {
      log.push(`ask ${tab.id}${tabs.active === tab ? ' (showing)' : ''}`)
      onAsk(tab)
      return answers.shift() ?? 'cancel'
    },
    requestSave: (tab) => {
      log.push(`save ${tab.id}`)
      const landed = saves.shift() ?? true
      queueMicrotask(() => {
        if (landed) tabs.report(tab, { ...tab.doc, path: tab.doc.path ?? `/work/${tab.id}.ipynb`, dirty: false })
        tabs.finishSave(tab, landed)
      })
    },
    forgetChanges: (tab) => log.push(`forget ${tab.id}`),
    closeWindow: () => windowClosed++,
    changed: () => {},
  })
  /** A tab whose page has loaded and reported this notebook. */
  const open = (doc: { path?: string | null; dirty?: boolean } = {}) => {
    const tab = tabs.create()
    tab.menuReady = true
    tabs.report(tab, { path: doc.path ?? null, dirty: doc.dirty ?? false })
    return tab
  }
  const attached = () => views.filter((v) => v.attached).map((v) => v.id)
  return { tabs, open, log, attached, windowClosed: () => windowClosed }
}

const ids = (list: readonly T[]) => list.map((t) => t.id)

describe('Tabs', () => {
  it('opens tabs at the end, each with its own view and session, and shows only the active one', () => {
    const { tabs, open, attached } = setup()
    const a = open({ path: '/work/a.ipynb' })
    const b = open()
    expect(ids(tabs.all)).toEqual([a.id, b.id])
    expect(a.session).not.toBe(b.session)
    expect(tabs.active).toBe(b)
    expect(attached()).toEqual([b.id])
    expect(b.view.focused).toBe(true)

    const c = tabs.create({ show: false })
    expect(tabs.active).toBe(b)
    expect(ids(tabs.all)).toEqual([a.id, b.id, c.id])
  })

  it('switches tabs, attaching and focusing only the one shown, and cycles both ways', () => {
    const { tabs, open, attached } = setup()
    const [a, b, c] = [open(), open(), open()]
    tabs.activate(a)
    expect(attached()).toEqual([a.id])
    expect(a.view.focused).toBe(true)
    tabs.cycle(1)
    expect(tabs.active).toBe(b)
    tabs.cycle(1)
    tabs.cycle(1)
    expect(tabs.active).toBe(a)
    tabs.cycle(-1)
    expect(tabs.active).toBe(c)
    expect(attached()).toEqual([c.id])
  })

  it('lists each tab’s name, unsaved changes and running cells for the strip', () => {
    const { tabs, open } = setup()
    const a = open({ path: '/work/Survival readout.ipynb', dirty: true })
    const b = open()
    tabs.report(b, { path: null, dirty: false, running: true })
    expect(tabs.info()).toEqual([
      { id: a.id, title: 'Survival readout', path: '/work/Survival readout.ipynb', dirty: true, running: false },
      { id: b.id, title: 'Untitled', path: null, dirty: false, running: true },
    ])
    expect([tabTitle('/work/sales.IPYNB'), tabTitle(null)]).toEqual(['sales', 'Untitled'])
  })

  it('finds the tab that has a file open, and tells an untouched Untitled apart', () => {
    const { tabs, open } = setup()
    const a = open({ path: '/work/a.ipynb' })
    const blank = open()
    const scratch = open({ dirty: true })
    expect(tabs.byPath('/work/../work/a.ipynb')).toBe(a)
    expect(tabs.byPath('/work/b.ipynb')).toBeNull()
    expect([a, blank, scratch].map((t) => tabs.isBlank(t))).toEqual([false, true, false])
  })

  it('brings forward the tab that has a file already, reuses an untouched Untitled, and opens a new tab otherwise', () => {
    const { tabs, open } = setup()
    const a = open({ path: '/work/a.ipynb' })
    const blank = open()
    const scratch = open({ dirty: true })
    // Reopening a file that's open in any tab, even from a blank one, goes to that tab
    expect(tabs.placement(blank, '/work/a.ipynb')).toEqual({ to: 'existing', tab: a })
    expect(tabs.placement(a, '/work/b.ipynb')).toEqual({ to: 'new' })
    expect(tabs.placement(scratch, '/work/b.ipynb')).toEqual({ to: 'new' })
    expect(tabs.placement(blank, '/work/b.ipynb')).toEqual({ to: 'here', tab: blank })
    expect(tabs.placement(blank, null)).toEqual({ to: 'here', tab: blank })
    // Once the blank tab has a notebook, the next open goes elsewhere
    tabs.report(blank, { path: '/work/b.ipynb', dirty: false })
    expect(tabs.placement(blank, '/work/c.ipynb')).toEqual({ to: 'new' })
    expect(tabs.placement(null, '/work/c.ipynb')).toEqual({ to: 'new' })
  })

  it('closes a clean tab straight away, shutting its kernel down and showing the tab to its right', async () => {
    const { tabs, open, log, attached } = setup()
    const [a, b, c] = [open(), open(), open()]
    tabs.activate(b)
    expect(await tabs.close(b)).toBe(true)
    expect(ids(tabs.all)).toEqual([a.id, c.id])
    expect(b.session.shutdown).toBe(true)
    expect(b.view.destroyed).toBe(true)
    expect(tabs.active).toBe(c)
    expect(attached()).toEqual([c.id])
    expect(log).toEqual([`dispose ${b.id}`])
    // The last tab on the right hands over to its left
    await tabs.close(c)
    expect(tabs.active).toBe(a)
  })

  it('asks before closing a tab with unsaved changes, showing it first', async () => {
    const { tabs, open, log } = setup({ answers: ['cancel', 'discard'] })
    const a = open()
    const b = open({ dirty: true })
    tabs.activate(a)
    expect(await tabs.close(b)).toBe(false)
    expect(ids(tabs.all)).toEqual([a.id, b.id])
    expect(await tabs.close(b)).toBe(true)
    expect(ids(tabs.all)).toEqual([a.id])
    expect(log).toEqual([`ask ${b.id} (showing)`, `ask ${b.id} (showing)`, `forget ${b.id}`, `dispose ${b.id}`])
  })

  it('saves a tab before closing it, and keeps it when the save does not land', async () => {
    const { tabs, open, log } = setup({ answers: ['save', 'save'], saves: [false, true] })
    open()
    const b = open({ dirty: true })
    expect(await tabs.close(b)).toBe(false)
    expect(tabs.all).toContain(b)
    expect(b.afterSave).toBeNull()
    expect(await tabs.close(b)).toBe(true)
    expect(log).toEqual([`ask ${b.id} (showing)`, `save ${b.id}`, `ask ${b.id} (showing)`, `save ${b.id}`, `dispose ${b.id}`])
  })

  it('does not wait on a save the page cannot take, or one cut short by a reload', async () => {
    const { tabs, open, log } = setup({ answers: ['save', 'save'] })
    open()
    const b = open({ dirty: true })
    b.menuReady = false
    expect(await tabs.close(b)).toBe(false)
    expect(log).toEqual([`ask ${b.id} (showing)`])

    // A page that reloads mid-save never answers, so the close stops rather than hang
    const c = open({ dirty: true })
    const closing = tabs.close(c)
    await Promise.resolve()
    tabs.pageReset(c)
    expect(await closing).toBe(false)
  })

  it('closes the window instead of the last tab', async () => {
    const { tabs, open, windowClosed } = setup()
    const a = open({ dirty: true })
    expect(await tabs.close(a)).toBe(false)
    expect(windowClosed()).toBe(1)
    expect(tabs.all).toEqual([a])
  })

  it('walks every tab with unsaved changes before the window closes or the app quits', async () => {
    const { tabs, open, log } = setup({ answers: ['save', 'discard'] })
    const a = open({ dirty: true })
    open({ path: '/work/clean.ipynb' })
    const c = open({ dirty: true })
    expect(await tabs.confirmAll()).toBe(true)
    expect(log).toEqual([`ask ${a.id} (showing)`, `save ${a.id}`, `ask ${c.id} (showing)`, `forget ${c.id}`])
  })

  it('also asks about a tab that gets unsaved changes while another tab’s dialog is up', async () => {
    let a!: T
    const { tabs, open, log } = setup({
      answers: ['discard', 'discard'],
      // A run in the first tab finishes and marks it changed while the second tab's dialog shows
      onAsk: (tab) => tab !== a && tabs.report(a, { ...a.doc, dirty: true }),
    })
    a = open({ path: '/work/a.ipynb' })
    const b = open({ dirty: true })
    expect(await tabs.confirmAll()).toBe(true)
    expect(log).toEqual([`ask ${b.id} (showing)`, `ask ${a.id} (showing)`, `forget ${b.id}`, `forget ${a.id}`])
  })

  it('stops the whole close on Cancel, keeping the changes of a tab that said Don’t Save before it', async () => {
    const { tabs, open, log } = setup({ answers: ['discard', 'cancel'] })
    const a = open({ dirty: true })
    const b = open({ dirty: true })
    const c = open({ dirty: true })
    expect(await tabs.confirmAll()).toBe(false)
    expect(log).toEqual([`ask ${a.id} (showing)`, `ask ${b.id} (showing)`])
    expect(ids(tabs.all)).toEqual([a.id, b.id, c.id])
    expect(tabs.anyDirty).toBe(true)
  })

  it('stops the close when a save in the walk does not land', async () => {
    const { tabs, open, log } = setup({ answers: ['save'], saves: [false] })
    const a = open({ dirty: true })
    const b = open({ dirty: true })
    expect(await tabs.confirmAll()).toBe(false)
    expect(log).toEqual([`ask ${a.id} (showing)`, `save ${a.id}`])
    expect(b.doc.dirty).toBe(true)
  })

  it('clears every tab when the window goes, without asking', () => {
    const { tabs, open, log } = setup()
    const [a, b] = [open({ dirty: true }), open()]
    expect(tabs.clear()).toEqual([a, b])
    expect(tabs.all).toEqual([])
    expect(tabs.active).toBeNull()
    expect(log).toEqual([])
  })
})
