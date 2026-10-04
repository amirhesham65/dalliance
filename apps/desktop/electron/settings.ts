import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { type Effort, type SettingsUpdate, type SettingsView, offeredEffort } from '@dalliance/shared/ipc'
import { writeFileAtomicSync } from './atomic-write'
import { type CloudAccess, DEFAULT_MODEL, type ModelConfig } from './harness/model'

interface Stored {
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  autoTitles: boolean
  suggestNext: boolean
  /** Whether the Activity pane shows what runs cost. Off until the user turns it on. */
  showCosts: boolean
  onboarded: boolean
  /** The folder in use: where new notebooks go, and where the kernel and the agent work. Null for the default one. */
  workspaceDir: string | null
  /** Where new projects go. Null for the default folder. */
  projectsDir: string | null
  /** Notebooks opened or saved lately, newest first. */
  recent: { path: string; openedAt: number }[]
}

const MAX_RECENT = 8

const DEFAULTS: Stored = {
  model: DEFAULT_MODEL,
  effort: 'medium',
  pythonPath: null,
  approvalMode: 'interactive',
  autoTitles: true,
  suggestNext: true,
  showCosts: false,
  onboarded: false,
  workspaceDir: null,
  projectsDir: null,
  recent: [],
}

export class SettingsStore {
  private data: Stored
  private readonly file: string
  /** How models reach Dalliance Cloud, for modelConfig(). */
  private readonly cloud: CloudAccess

  constructor(dir: string, cloud: CloudAccess) {
    this.cloud = cloud
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'settings.json')
    this.data = structuredClone(DEFAULTS)
    if (existsSync(this.file)) {
      let stored: Partial<Stored>
      try {
        stored = JSON.parse(readFileSync(this.file, 'utf-8'))
        if (typeof stored !== 'object' || stored == null || Array.isArray(stored)) throw new Error('not a JSON object')
      } catch (err) {
        this.setAside(err)
        return
      }
      // A setting the file doesn't have takes its default
      this.data = { ...structuredClone(DEFAULTS), ...stored }
      // Extra high and Max aren't offered for now, so a saved one reads as High
      this.data.effort = offeredEffort(this.data.effort)
    }
  }

  /**
   * A settings file that can't be read falls back to the defaults. It's moved aside first, so the next save
   * doesn't overwrite the recent notebooks it may still hold.
   */
  private setAside(reason: unknown) {
    const aside = `${this.file}.corrupt-${Date.now()}`
    try {
      renameSync(this.file, aside)
      console.warn(`settings.json could not be read (${String(reason)}). Moved it to ${aside} and started from the defaults.`)
    } catch (err) {
      console.warn(`settings.json could not be read (${String(reason)}), and moving it aside failed (${String(err)}).`)
    }
  }

  private save() {
    writeFileAtomicSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  modelConfig(): ModelConfig {
    return { model: this.data.model, effort: this.data.effort, cloud: this.cloud }
  }

  get pythonPath() {
    return this.data.pythonPath
  }

  get approvalMode() {
    return this.data.approvalMode
  }

  get autoTitles() {
    return this.data.autoTitles
  }

  get suggestNext() {
    return this.data.suggestNext
  }

  get showCosts() {
    return this.data.showCosts
  }

  /** The folder last worked in, if it is still there. */
  get workspaceDir() {
    const dir = this.data.workspaceDir
    return dir && existsSync(dir) ? dir : null
  }

  setWorkspaceDir(dir: string) {
    if (dir === this.data.workspaceDir) return
    this.data.workspaceDir = dir
    this.save()
  }

  /** The folder chosen for new projects, if it is still there. */
  get projectsDir() {
    const dir = this.data.projectsDir
    return dir && existsSync(dir) ? dir : null
  }

  setProjectsDir(dir: string) {
    if (dir === this.data.projectsDir) return
    this.data.projectsDir = dir
    this.save()
  }

  get recent() {
    return this.data.recent
  }

  addRecent(file: string) {
    this.data.recent = [{ path: file, openedAt: Date.now() }, ...this.data.recent.filter((r) => r.path !== file)].slice(0, MAX_RECENT)
    this.save()
  }

  removeRecent(file: string) {
    this.data.recent = this.data.recent.filter((r) => r.path !== file)
    this.save()
  }

  view(): SettingsView {
    return {
      model: this.data.model,
      effort: this.data.effort,
      pythonPath: this.data.pythonPath,
      approvalMode: this.data.approvalMode,
      autoTitles: this.data.autoTitles,
      suggestNext: this.data.suggestNext,
      showCosts: this.data.showCosts,
      onboarded: this.data.onboarded,
    }
  }

  update(update: SettingsUpdate): SettingsView {
    if (update.model !== undefined) this.data.model = update.model.trim() || DEFAULT_MODEL
    if (update.effort) this.data.effort = offeredEffort(update.effort)
    if (update.pythonPath !== undefined) this.data.pythonPath = update.pythonPath?.trim().replace(/^~(?=$|\/)/, homedir()) || null
    if (update.approvalMode) this.data.approvalMode = update.approvalMode
    if (update.autoTitles !== undefined) this.data.autoTitles = update.autoTitles
    if (update.suggestNext !== undefined) this.data.suggestNext = update.suggestNext
    if (update.showCosts !== undefined) this.data.showCosts = update.showCosts
    if (update.onboarded !== undefined) this.data.onboarded = update.onboarded
    this.save()
    return this.view()
  }
}
