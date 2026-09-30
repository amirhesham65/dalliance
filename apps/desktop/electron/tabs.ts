import path from 'node:path'
import type { DocumentState, TabInfo } from '@dalliance/shared/ipc'

/** What a tab's page last said about its notebook. */
export interface TabDoc {
  path: string | null
  dirty: boolean
  running: boolean
}

/** One tab: its page, its session, and what the main process tracks for it. */
export interface Tab<V, S> {
  readonly id: string
  readonly view: V
  readonly session: S
  doc: TabDoc
  /** Whether the page has asked for its notebook before, so the next ask is a reload and the kernel kept its state. */
  restored: boolean
  /** Whether the page has subscribed to menu actions since it last started loading. */
  menuReady: boolean
  /** Set while a Save chosen in the close dialog is under way. Called with whether the file was written. */
  afterSave: ((saved: boolean) => void) | null
}

export type CloseChoice = 'save' | 'discard' | 'cancel'

/** Everything the registry needs from Electron and the rest of the main process. main.ts builds it, tests fake it. */
export interface TabHost<V, S> {
  createView(id: string): V
  createSession(id: string): S
  /** Attach the view to the window, size it and give it keyboard focus. */
  show(view: V): void
  /** Detach the view. Its page keeps running in the background. */
  hide(view: V): void
  /** A tab closed on its own: destroy its view, shut its kernel down and forget its draft. */
  dispose(tab: Tab<V, S>): void
  /** Save / Don't Save / Cancel for a tab with unsaved changes. The tab is showing when this is called. */
  askToSave(tab: Tab<V, S>): Promise<CloseChoice>
  /** Send the tab's page the `save` menu action. Its saveNotebook() call ends with `finishSave()`. */
  requestSave(tab: Tab<V, S>): void
  /** Don't Save: the next launch opens the tab's file without these changes. */
  forgetChanges(tab: Tab<V, S>): void
  closeWindow(): void
  /** The list, the active tab, or a tab's name, unsaved changes or running state changed. */
  changed(): void
}

/** The name the strip shows for a notebook: its file name without .ipynb, or Untitled. */
export const tabTitle = (file: string | null) => (file ? path.basename(file).replace(/\.ipynb$/i, '') : 'Untitled')

/**
 * The window's tabs, in strip order, and which one shows. Each tab has its own page and its own session, so every
 * IPC call resolves its tab from the page that sent it. Only the active tab's view is attached to the window.
 */
export class Tabs<V, S> {
  private list: Tab<V, S>[] = []
  private activeTab: Tab<V, S> | null = null
  private nextId = 1
  private readonly host: TabHost<V, S>

  constructor(host: TabHost<V, S>) {
    this.host = host
  }

  get all(): readonly Tab<V, S>[] {
    return this.list
  }

  get active(): Tab<V, S> | null {
    return this.activeTab
  }

  /** A new tab at the end of the strip, shown unless `show` is false. `doc` is what it opens with, if anything. */
  create({ doc, show = true }: { doc?: Partial<TabDoc>; show?: boolean } = {}): Tab<V, S> {
    const id = `tab-${this.nextId++}`
    const tab: Tab<V, S> = {
      id,
      view: this.host.createView(id),
      session: this.host.createSession(id),
      doc: { path: null, dirty: false, running: false, ...doc },
      restored: false,
      menuReady: false,
      afterSave: null,
    }
    this.list.push(tab)
    if (show || !this.activeTab) this.activate(tab)
    else this.host.changed()
    return tab
  }

  activate(tab: Tab<V, S>) {
    if (!this.list.includes(tab)) return
    if (this.activeTab !== tab) {
      if (this.activeTab) this.host.hide(this.activeTab.view)
      this.activeTab = tab
    }
    this.host.show(tab.view)
    this.host.changed()
  }

  /** The next tab to the right, or with a negative step to the left, wrapping round. */
  cycle(step: number) {
    if (!this.activeTab || this.list.length < 2) return
    const i = this.list.indexOf(this.activeTab)
    this.activate(this.list[(i + step + this.list.length) % this.list.length])
  }

  byId(id: unknown): Tab<V, S> | null {
    return this.list.find((t) => t.id === id) ?? null
  }

  find(match: (tab: Tab<V, S>) => boolean): Tab<V, S> | null {
    return this.list.find(match) ?? null
  }

  /** The tab that has this notebook file open, if one does. */
  byPath(file: string): Tab<V, S> | null {
    const wanted = path.resolve(file)
    return this.list.find((t) => t.doc.path != null && path.resolve(t.doc.path) === wanted) ?? null
  }

  /** An untouched Untitled: no file and no changes, like a new tab on the start page. Opening a notebook reuses it. */
  isBlank(tab: Tab<V, S>): boolean {
    return tab.doc.path == null && !tab.doc.dirty
  }

  /**
   * Where a notebook opened from `caller` goes. The tab that has the file open already comes forward, the caller
   * takes it when it's an untouched Untitled, and otherwise a new tab does. `file` is null for a notebook just made.
   */
  placement(caller: Tab<V, S> | null, file: string | null): { to: 'existing' | 'here'; tab: Tab<V, S> } | { to: 'new' } {
    const existing = file ? this.byPath(file) : null
    if (existing) return { to: 'existing', tab: existing }
    if (caller && this.list.includes(caller) && this.isBlank(caller)) return { to: 'here', tab: caller }
    return { to: 'new' }
  }

  /** The page reported its notebook. */
  report(tab: Tab<V, S>, state: DocumentState) {
    tab.doc = { path: state.path, dirty: state.dirty, running: state.running ?? false }
    this.host.changed()
  }

  info(): TabInfo[] {
    return this.list.map((t) => ({ id: t.id, title: tabTitle(t.doc.path), path: t.doc.path, dirty: t.doc.dirty, running: t.doc.running }))
  }

  /** The page started loading again, or went away. A close waiting on its save won't get one. */
  pageReset(tab: Tab<V, S>) {
    tab.menuReady = false
    this.finishSave(tab, false)
  }

  /** A save from this tab's page ended, written or not. A close waiting on it carries on or stops. */
  finishSave(tab: Tab<V, S>, saved: boolean) {
    const done = tab.afterSave
    tab.afterSave = null
    done?.(saved)
  }

  /** Save a tab for a close and wait for it. False when the file wasn't written, or the page can't take the request. */
  private save(tab: Tab<V, S>): Promise<boolean> {
    if (!tab.menuReady) return Promise.resolve(false)
    this.finishSave(tab, false)
    return new Promise((resolve) => {
      tab.afterSave = resolve
      this.host.requestSave(tab)
    })
  }

  /** Ask about a tab with unsaved changes, showing it first. Resolves true when the tab may go. */
  private async settle(tab: Tab<V, S>, discarded: Tab<V, S>[]): Promise<boolean> {
    this.activate(tab)
    const choice = await this.host.askToSave(tab)
    if (choice === 'cancel') return false
    if (choice === 'discard') {
      discarded.push(tab)
      return true
    }
    return this.save(tab)
  }

  /**
   * Close one tab, asking first when it has unsaved changes. The last tab closes the window instead, which asks
   * through `confirmAll()`. Resolves true when the tab closed.
   */
  async close(tab: Tab<V, S>): Promise<boolean> {
    if (!this.list.includes(tab)) return false
    if (this.list.length === 1) {
      this.host.closeWindow()
      return false
    }
    if (tab.doc.dirty) {
      const discarded: Tab<V, S>[] = []
      if (!(await this.settle(tab, discarded))) return false
      for (const t of discarded) this.host.forgetChanges(t)
      // The page may have closed it some other way while the dialog was up
      if (!this.list.includes(tab)) return true
    }
    this.remove(tab)
    return true
  }

  /**
   * Before the window closes or the app quits: walk every tab with unsaved changes through Save / Don't Save /
   * Cancel, in strip order. Cancel, or a save that doesn't land, stops the whole close. Don't Save only forgets the
   * changes once every tab has answered, so a Cancel later on keeps them.
   */
  async confirmAll(): Promise<boolean> {
    const discarded: Tab<V, S>[] = []
    for (const tab of [...this.list]) {
      if (!this.list.includes(tab) || !tab.doc.dirty) continue
      if (!(await this.settle(tab, discarded))) return false
    }
    for (const tab of discarded) this.host.forgetChanges(tab)
    return true
  }

  get anyDirty(): boolean {
    return this.list.some((t) => t.doc.dirty)
  }

  /** Take a tab out of the strip and dispose of it. The tab to its right shows next, or the one to its left. */
  private remove(tab: Tab<V, S>) {
    const i = this.list.indexOf(tab)
    if (i < 0) return
    this.list.splice(i, 1)
    this.finishSave(tab, false)
    if (this.activeTab === tab) {
      this.host.hide(tab.view)
      this.activeTab = null
      const next = this.list[Math.min(i, this.list.length - 1)]
      if (next) this.activate(next)
    }
    this.host.dispose(tab)
    this.host.changed()
  }

  /** The window closed: every tab goes with it. Returns them so the caller can shut their sessions down. */
  clear(): Tab<V, S>[] {
    const gone = this.list
    this.list = []
    this.activeTab = null
    for (const tab of gone) this.finishSave(tab, false)
    return gone
  }
}
