import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DraftState, RestoredSession } from '@dalliance/shared/ipc'
import { fromIpynb, toIpynb } from '@dalliance/shared/ipynb'

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

  /** The notebook to show when the window loads, or null for a fresh one. */
  restore(): RestoredSession | null {
    if (this.live) return { ...this.live, kernelKept: true }
    const saved = this.read()
    if (!saved) return null
    const onDisk = saved.path != null && existsSync(saved.path)
    try {
      // A clean notebook comes from its file, so changes made outside the app show up
      if (onDisk && (!saved.dirty || saved.ipynb == null)) {
        return { path: saved.path, dirty: false, notebook: fromIpynb(JSON.parse(readFileSync(saved.path!, 'utf-8'))), kernelKept: false }
      }
      if (saved.ipynb != null) return { path: onDisk ? saved.path : null, dirty: true, notebook: fromIpynb(saved.ipynb), kernelKept: false }
    } catch {
      // A notebook that no longer parses isn't worth failing startup over
    }
    return null
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
      writeFileSync(this.file, JSON.stringify(data))
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
