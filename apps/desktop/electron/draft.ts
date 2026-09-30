import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { DraftState, RestoreFailure, RestoredSession } from '@dalliance/shared/ipc'
import { fromIpynb, toIpynb } from '@dalliance/shared/ipynb'
import { writeFileAtomicSync } from './atomic-write'

/** What goes to disk: where the notebook lives, and its contents only when there are unsaved changes. */
interface OnDisk {
  path: string | null
  dirty: boolean
  ipynb: unknown | null
}

const WRITE_DELAY_MS = 1000

/**
 * Remembers the open notebook, so a reload of the window or a relaunch of the app picks up where you were.
 * Within one run of the app it hands back the notebook exactly as it was, since the kernel is still alive.
 * Across launches it reopens the saved file, or the unsaved copy if there were changes.
 */
export class DraftStore {
  private live: DraftState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly file: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'session.json')
  }

  update(state: DraftState) {
    this.live = state
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  /**
   * The notebook to show when the window loads, or null for a fresh one. A notebook that is there but won't open,
   * such as one a newer version of Dalliance saved, comes back as a RestoreFailure so the user learns why.
   */
  restore(): RestoredSession | RestoreFailure | null {
    if (this.live) return { ...this.live, kernelKept: true }
    const saved = this.read()
    if (!saved) return null
    const onDisk = saved.path != null && existsSync(saved.path)
    // A clean notebook comes from its file, so changes made outside the app show up
    const fromFile = onDisk && (!saved.dirty || saved.ipynb == null)
    if (!fromFile && saved.ipynb == null) return null
    try {
      if (fromFile) return { path: saved.path, dirty: false, notebook: fromIpynb(JSON.parse(readFileSync(saved.path!, 'utf-8'))), kernelKept: false }
      return { path: onDisk ? saved.path : null, dirty: true, notebook: fromIpynb(saved.ipynb), kernelKept: false }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (fromFile) return { path: saved.path, error: `Couldn't reopen ${path.basename(saved.path!)}. ${reason}` }
      // The unsaved copy lives only in session.json. Keep it out of the way of the next draft, so it isn't lost.
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

  /** Don't Save: the next launch opens the file as it is on disk, without these changes. */
  forgetChanges() {
    if (this.live) this.live = { ...this.live, dirty: false }
    this.flush()
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.live) return
    const { path: file, dirty, notebook } = this.live
    const data: OnDisk = { path: file, dirty, ipynb: dirty ? toIpynb(notebook) : null }
    try {
      writeFileAtomicSync(this.file, JSON.stringify(data))
    } catch {
      // Losing the draft only means the next launch starts fresh
    }
  }

  private read(): OnDisk | null {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf-8')) as OnDisk
      return data.path || data.ipynb ? data : null
    } catch {
      return null
    }
  }
}
