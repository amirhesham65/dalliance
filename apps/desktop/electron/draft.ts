import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { DraftState, RestoreFailure, RestoredSession } from '@dalliance/shared/ipc'
import { fromIpynb, toIpynb } from '@dalliance/shared/ipynb'
import { writeFileAtomicSync } from './atomic-write'

/** One tab on disk: where its notebook lives, and its contents only when there are unsaved changes. */
export interface SavedTab {
  path: string | null
  dirty: boolean
  ipynb: unknown | null
}

/** What the last run left open: its tabs in order, and the index of the one that was showing. */
export interface SavedSession {
  tabs: SavedTab[]
  active: number
}

/**
 * session.json. Version 2 holds a list of tabs. Version 1 had no `version` field and held one notebook's
 * `path`, `dirty` and `ipynb` at the top level; `read()` turns it into a single tab.
 */
interface OnDisk {
  version: 2
  active: number
  tabs: SavedTab[]
}

const WRITE_DELAY_MS = 1000

/** A tab's draft: what its page last sent, and what the last run saved for it until the page sends something. */
interface Entry {
  live: DraftState | null
  saved: SavedTab | null
}

/**
 * Remembers the open tabs, so a reload of a tab or a relaunch of the app picks up where you were.
 * Within one run of the app it hands a tab back its notebook exactly as it was, since its kernel is still alive.
 * Across launches it reopens each saved file, or the unsaved copy if there were changes.
 */
export class DraftStore {
  private entries = new Map<string, Entry>()
  /** Tabs that closed. A save that lands after its tab closed never brings the tab back. Ids are never reused. */
  private gone = new Set<string>()
  private order: string[] = []
  private active: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly file: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'session.json')
  }

  /** The tabs the last run left open. A file from before tabs becomes one tab. Nothing readable is no tabs. */
  read(): SavedSession {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<OnDisk> & Partial<SavedTab>
      if (data.version === 2 && Array.isArray(data.tabs)) {
        const tabs = data.tabs.filter((t): t is SavedTab => t != null && typeof t === 'object' && (t.path != null || t.ipynb != null))
        const active = typeof data.active === 'number' ? Math.min(Math.max(0, data.active), Math.max(0, tabs.length - 1)) : 0
        return { tabs, active }
      }
      if (data.path || data.ipynb) return { tabs: [{ path: data.path ?? null, dirty: data.dirty === true, ipynb: data.ipynb ?? null }], active: 0 }
    } catch {
      // No file yet, or one that doesn't parse: start with no tabs
    }
    return { tabs: [], active: 0 }
  }

  /** A tab opened, with what the last run saved for it, if it came back from session.json. */
  open(id: string, saved: SavedTab | null = null) {
    this.entries.set(id, { live: null, saved })
  }

  /** The tabs' order and the one showing, as the next write should record them. */
  arrange(order: string[], active: string | null) {
    if (active === this.active && order.length === this.order.length && order.every((id, i) => id === this.order[i])) return
    this.order = [...order]
    this.active = active
    this.schedule()
  }

  update(id: string, state: DraftState) {
    if (this.gone.has(id)) return
    const entry = this.entries.get(id)
    if (entry) entry.live = state
    else this.entries.set(id, { live: state, saved: null })
    this.schedule()
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  /**
   * The notebook a tab shows when its page loads, or null for the start page. `reload` is true when the page loaded
   * before, so its kernel is still alive. A notebook that is there but won't open, such as one a newer version of
   * Dalliance saved, comes back as a RestoreFailure so the user learns why.
   */
  restore(id: string, reload: boolean): RestoredSession | RestoreFailure | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    if (entry.live) return { ...entry.live, kernelKept: reload }
    const saved = entry.saved
    if (!saved) return null
    const onDisk = saved.path != null && existsSync(saved.path)
    // A clean notebook comes from its file, so changes made outside the app show up
    const fromFile = onDisk && (!saved.dirty || saved.ipynb == null)
    if (!fromFile && saved.ipynb == null) return null
    try {
      const restored: DraftState = fromFile
        ? { path: saved.path, dirty: false, notebook: fromIpynb(JSON.parse(readFileSync(saved.path!, 'utf-8'))) }
        : { path: onDisk ? saved.path : null, dirty: true, notebook: fromIpynb(saved.ipynb) }
      // A reload of this tab from now on gets it back as it is, with its kernel
      entry.live = restored
      return { ...restored, kernelKept: false }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (fromFile) return { path: saved.path, error: `Couldn't reopen ${path.basename(saved.path!)}. ${reason}` }
      // The unsaved copy lives only in session.json. Keep it out of the way of the next draft, so it isn't lost.
      entry.saved = null
      const aside = this.setAside()
      return { path: null, error: `Couldn't reopen your unsaved notebook. ${reason}${aside ? ` A copy is in ${aside}.` : ''}` }
    }
  }

  /** Move session.json aside. Returns where it went, or null when it couldn't be moved. */
  private setAside(): string | null {
    const aside = `${this.file}.unrestored-${Date.now()}`
    try {
      renameSync(this.file, aside)
      return aside
    } catch {
      return null
    }
  }

  /** Don't Save: the next launch opens the tab's file as it is on disk, without these changes. */
  forgetChanges(id: string) {
    const entry = this.entries.get(id)
    if (entry?.live) entry.live = { ...entry.live, dirty: false }
    if (entry?.saved) entry.saved = { ...entry.saved, dirty: false, ipynb: null }
    this.flush()
  }

  /** The tab closed. The next launch doesn't bring it back. */
  close(id: string) {
    this.gone.add(id)
    this.entries.delete(id)
    this.order = this.order.filter((o) => o !== id)
    if (this.active === id) this.active = null
    this.flush()
  }

  /** The window closed with these tabs, written already. Forget them here, and leave session.json as it is. */
  clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const id of this.entries.keys()) this.gone.add(id)
    this.entries.clear()
    this.order = []
    this.active = null
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // Nothing open, as after the window closed: keep what the last write recorded
    if (this.entries.size === 0) return
    const ids = [...this.order.filter((id) => this.entries.has(id)), ...[...this.entries.keys()].filter((id) => !this.order.includes(id))]
    const kept: { id: string; tab: SavedTab }[] = []
    for (const id of ids) {
      const tab = this.onDisk(this.entries.get(id)!)
      // A tab with no file and nothing unsaved is the start page or an empty notebook. There's nothing to bring back.
      if (tab.path != null || tab.ipynb != null) kept.push({ id, tab })
    }
    const data: OnDisk = { version: 2, active: Math.max(0, kept.findIndex((k) => k.id === this.active)), tabs: kept.map((k) => k.tab) }
    try {
      writeFileAtomicSync(this.file, JSON.stringify(data))
    } catch {
      // Losing the drafts only means the next launch starts fresh
    }
  }

  private onDisk(entry: Entry): SavedTab {
    if (!entry.live) return entry.saved ?? { path: null, dirty: false, ipynb: null }
    const { path: file, dirty, notebook } = entry.live
    return { path: file, dirty, ipynb: dirty ? toIpynb(notebook) : null }
  }
}
