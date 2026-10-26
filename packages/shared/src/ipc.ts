import type { ProviderId } from './models'
import type { Correction, CreatedVariable, Notebook, Output, Pins, Provenance } from './notebook'

/** One line in a cell's activity log: what the agent did while writing the cell. */
export interface ActivityItem {
  id: string
  /** Plain words, never code. */
  label: string
  detail?: string
  /** The Python an explore or run_cell call sent, shown when the user opens the step. */
  code?: string
  status: 'running' | 'done' | 'error'
  /** A step that ended but hit an error it could get past, like an exploration that raised. */
  warning?: boolean
}

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'activity'; item: ActivityItem }
  /** A new attempt at running the cell starts. Clear the live outputs. */
  | { type: 'attempt'; code: string }
  | { type: 'output'; output: Output }
  | { type: 'question'; requestId: string; question: string; options: string[] }
  | { type: 'approval'; requestId: string; title: string; detail: string }
  /**
   * A short name for the cell arrived. It can land before or after the run ends. `cost` reports its
   * token usage, which counts toward the notebook total even when the display is off.
   */
  | { type: 'title'; title: string; prompt: string; cost?: RunCost }

export interface RunCellRequest {
  cellId: string
  prompt: string
  code: string
  /** True when the agent must write the code. False to run the existing code directly. */
  generate: boolean
  corrections: Correction[]
  /** Files attached to the cell, as paths inside the notebook's folder. */
  attachments: string[]
  /** Ask the selected model for a title while a generated cell runs. */
  nameIt?: boolean
  previousCells: { kind: 'prompt' | 'note'; text: string; code?: string }[]
}

/** One model call of a run, for the record of how a cell was made. */
export interface RunStep {
  /** Which model call of the run, from 1. */
  step: number
  /** The model that answered, as the provider named it. */
  modelId: string | null
  /** The model's reasoning summary for this call. Null when it returned none, never left out. */
  reasoning: string | null
  /** The tokens the call used. */
  usage: StepUsage
}

/** Tokens one model call used, as the provider reported them. A count the provider left out is 0. */
export interface StepUsage {
  /** Every input token, the cached ones included. */
  inputTokens: number
  /** Every output token, the reasoning included. */
  outputTokens: number
  /** Input tokens read from the prompt cache. Part of inputTokens. */
  cacheReadTokens: number
  /** Input tokens written to the prompt cache. Part of inputTokens. */
  cacheWriteTokens: number
  /** Output tokens spent reasoning. Part of outputTokens. */
  reasoningTokens: number
}

/** Tokens used by a run or a title request. */
export interface RunCost {
  tokens: number
}

export interface CellRunResult {
  ok: boolean
  code: string
  outputs: Output[]
  executionCount: number | null
  durationMs: number
  generated: boolean
  interpretation: string | null
  answer: string | null
  /** Follow-up prompts the agent suggests. */
  suggestions: string[]
  /** Variables the final run assigned. */
  variables: CreatedVariable[]
  activity: ActivityItem[]
  /** Every model call of a generated run, in order. Empty for a plain run of saved code. */
  steps: RunStep[]
  /** Reported token usage. Absent when no model ran, collected even when its display is off. */
  cost?: RunCost
  /** How a generated run made the code. Absent for a plain run of saved code, which keeps the cell's record. */
  provenance?: Provenance | null
  /** Why the run failed, when the problem was not a Python error (missing key, stopped, the agent gave up). */
  error: string | null
}

export interface VariableView {
  name: string
  type: string
  shape: string
  detail: string
}

export type KernelStatus = 'starting' | 'idle' | 'busy' | 'dead'

export interface KernelState {
  status: KernelStatus
  python: string | null
  cwd: string
  error: string | null
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The efforts the app offers for now. The harness still maps all five per model, so the others can come back here. */
export const OFFERED_EFFORTS = ['low', 'medium', 'high'] as const satisfies readonly Effort[]

/** An offered effort: the one given, `high` for one above it, and the default `medium` for anything else. */
export function offeredEffort(effort: unknown): Effort {
  if ((OFFERED_EFFORTS as readonly unknown[]).includes(effort)) return effort as Effort
  return effort === 'xhigh' || effort === 'max' ? 'high' : 'medium'
}

export interface SettingsView {
  /** Provider and native model ID, such as `anthropic/claude-sonnet-5-5`. */
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  /** Whether the selected model names generated cells for the outline. */
  autoTitles: boolean
  /** Whether the agent proposes follow-up prompts under a finished cell. */
  suggestNext: boolean
  /** Whether the Activity pane shows token usage for runs and the notebook total. Off by default. */
  showUsage: boolean
  /** Last selected model for each provider. Contains no keys. */
  providerModels: Partial<Record<ProviderId, string>>
  /** True once the first-run setup was finished or skipped. */
  onboarded: boolean
}

export interface SettingsUpdate {
  model?: string
  effort?: Effort
  pythonPath?: string | null
  approvalMode?: 'interactive' | 'background'
  autoTitles?: boolean
  suggestNext?: boolean
  showUsage?: boolean
  onboarded?: boolean
}

/** A model in the local catalog or the user's custom selection. */
export interface ModelOption {
  id: string
  name: string
  /** Who makes the model, like Anthropic or OpenAI. */
  maker: string
  description?: string
}

export interface ModelList {
  models: ModelOption[]
  error: string | null
}

/** A library installed in the Python the kernel runs on. */
export interface PackageView {
  name: string
  version: string
}

/** What the environment view shows: the Python, and the libraries it has. */
export interface EnvironmentView {
  python: string | null
  version: string | null
  packages: PackageView[]
  /** Why the libraries couldn't be listed, like no Python being set up. The packages are empty then. */
  error: string | null
}
/**
 * What renaming a notebook came to: its new path, or why it couldn't be. A rename that wrote the file recorded its
 * pins too, like a save.
 */
export type RenameResult = { path: string; /** True when the notebook had no file, so the rename wrote it. */ saved: boolean; pins?: Pins | null } | { error: string }

/** A saved notebook: where it went, and the pins the save recorded, or null when there was nothing to record. */
export interface SavedNotebook {
  path: string
  pins: Pins | null
}

/**
 * One way the environment or the data differs from what the notebook's pins recorded. `now` is null for a package
 * that isn't installed any more. A file's `size` changed, or it kept its size and its `contents` hash differently.
 */
export type PinChange =
  | { kind: 'python'; was: string; now: string }
  | { kind: 'package'; name: string; was: string; now: string | null }
  | { kind: 'file'; path: string; change: 'missing' | 'size' | 'contents' }

export interface PythonState {
  python: string | null
  version: string | null
  source: 'settings' | 'managed' | 'system' | null
  managedEnvExists: boolean
  missingPackages: string[]
}

/** The notebook folder's AGENTS.md, which the agent reads before every cell. */
export interface Brief {
  path: string
  text: string | null
}

export interface FileEntry {
  path: string
  size: string
  kind: 'file' | 'directory'
}

export interface RecentNotebook {
  path: string
  name: string
  folder: string
  openedAt: number
}

/** The open notebook as the renderer last sent it, kept by the main process across reloads. */
export interface DraftState {
  path: string | null
  dirty: boolean
  notebook: Notebook
}

export interface RestoredSession extends DraftState {
  /** True after a window reload: the kernel kept running, so results and variables are still current. */
  kernelKept: boolean
}

/**
 * The last notebook is there but couldn't be reopened, for example because a newer version of Dalliance saved it.
 * The renderer shows the start page with `error`. It has no `notebook`, which tells it apart from a RestoredSession.
 */
export interface RestoreFailure {
  path: string | null
  error: string
}

/** A file from a drop in the window. The preload reads where it is on disk; the window never sees the path. */
export interface DroppedFile {
  readonly name: string
}

/** Files copied into the notebook's folder, as paths inside it, and why any of the rest weren't. */
export interface AttachResult {
  paths: string[]
  error: string | null
}

export interface OpenedNotebook {
  path: string | null
  notebook: Notebook
}

/** A new project's first notebook, open on a kernel in the project's folder, or why the project couldn't be made. */
export type CreatedProject = OpenedNotebook | { error: string }

export type MenuAction =
  | 'new'
  | 'new-project'
  | 'open'
  | 'open-project'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'run-cell'
  | 'run-all'
  | 'interrupt'
  | 'restart'
  | 'verify'
  | 'settings'
  | 'add-prompt'
  | 'add-note'
  | 'toggle-sidebar'
  | 'welcome'
  | `pane-${PaneName}`

/** The side panes, as the menu names them. */
export type PaneName = 'brief' | 'variables' | 'history' | 'files' | 'pinned' | 'activity'

/** Key status only. Saved key values never return to the renderer. */
export interface ProviderKeysView {
  configured: Record<ProviderId, boolean>
  persistent: boolean
  error: string | null
}

/** A newer release than the one running. See docs/releasing.md. */
export interface UpdateView {
  version: string
}

/** Everything the preload script exposes as window.dalliance. */
export interface DallianceApi {
  platform: string
  runCell(request: RunCellRequest): Promise<CellRunResult>
  onRunEvent(listener: (cellId: string, event: RunEvent) => void): () => void
  respond(requestId: string, answer: string | boolean | null): void
  interrupt(): Promise<void>
  restartKernel(): Promise<void>
  kernelState(): Promise<KernelState>
  listVariables(): Promise<VariableView[]>
  /** The Python in use and its libraries with versions. Reads the interpreter, so it never waits on a running cell. */
  listPackages(): Promise<EnvironmentView>
  onKernelState(listener: (state: KernelState) => void): () => void
  getSettings(): Promise<SettingsView>
  listModels(): Promise<ModelList>
  updateSettings(update: SettingsUpdate): Promise<SettingsView>
  pythonState(): Promise<PythonState>
  setupPython(): Promise<PythonState>
  onPythonLog(listener: (line: string) => void): () => void
  openNotebook(): Promise<OpenedNotebook | null>
  /** Writes a new notebook file into the folder in use, so it has a path from the start, on a fresh kernel. Null when the folder can't be written to, after the reason is shown. */
  newNotebook(notebook: Notebook): Promise<OpenedNotebook | null>
  /**
   * Makes a folder called `name` where new projects go, writes `notebook` into it under the same name, and opens it
   * on a kernel there. A bad or taken name, or a disk that refuses, comes back as an error. Never throws.
   */
  createProject(name: string, notebook: Notebook): Promise<CreatedProject>
  /**
   * Asks for a project folder and opens the notebook last opened there, or the newest one in it. A folder without
   * notebooks gets `notebook` as its first. Null when cancelled, or when the folder can't be used.
   */
  openProject(notebook: Notebook): Promise<OpenedNotebook | null>
  /** The folder new projects go in. */
  projectsFolder(): Promise<string>
  /** Asks for a new folder for projects to go in and remembers it. Null when cancelled. */
  chooseProjectsFolder(): Promise<string | null>
  openRecent(path: string): Promise<OpenedNotebook | null>
  recentNotebooks(): Promise<RecentNotebook[]>
  readBrief(): Promise<Brief>
  writeBrief(text: string): Promise<Brief>
  /** Immediate entries in a workspace-relative folder, with no count limit. Defaults to the workspace root. */
  listFiles(directory?: string): Promise<FileEntry[]>
  /**
   * Copies dropped files into `uploads` in the folder in use, under a free name, and returns their paths inside it. A
   * file already in the folder is used where it is. Never throws: what couldn't be copied comes back as `error`.
   */
  attachFiles(files: DroppedFile[]): Promise<AttachResult>
  /** Opens the folder in use in Finder, or the platform's file manager. Rejects with the reason when it can't. */
  revealFolder(): Promise<void>
  /**
   * Renames the open notebook's file, as Jupyter does. A notebook without a file is written under that name in the
   * folder in use. Unsaved edits stay unsaved. The name is checked, and a taken one comes back as an error.
   */
  renameNotebook(current: string | null, name: string, notebook: Notebook): Promise<RenameResult>
  /** Records the notebook's pins and writes it. Null when the Save dialog was cancelled. */
  saveNotebook(path: string | null, notebook: Notebook): Promise<SavedNotebook | null>
  /**
   * Compares pins with the Python, its packages and the files in the folder in use now. Empty when nothing changed.
   * Reads the interpreter, not the kernel, so a running cell doesn't hold it up.
   */
  checkPins(pins: Pins): Promise<PinChange[]>
  confirmDiscard(): Promise<boolean>
  restoreSession(): Promise<RestoredSession | RestoreFailure | null>
  saveDraft(state: DraftState): void
  setDocumentState(state: { path: string | null; dirty: boolean }): void
  onMenu(listener: (action: MenuAction) => void): () => void
  getProviderKeys(): Promise<ProviderKeysView>
  /** An empty key removes the provider's saved key. */
  setProviderKey(provider: ProviderId, key: string): Promise<ProviderKeysView>
  /** A newer release, once a check has found one. Null until then, and always in development. */
  getUpdate(): Promise<UpdateView | null>
  /** Opens the website's download in the browser, which serves the newest release. */
  downloadUpdate(): Promise<void>
  onUpdate(listener: (update: UpdateView) => void): () => void
}

export const IPC = {
  runCell: 'run-cell',
  runEvent: 'run-event',
  respond: 'respond',
  interrupt: 'interrupt',
  restartKernel: 'restart-kernel',
  kernelState: 'kernel-state',
  listVariables: 'list-variables',
  listPackages: 'list-packages',
  kernelStateChanged: 'kernel-state-changed',
  getSettings: 'get-settings',
  listModels: 'list-models',
  updateSettings: 'update-settings',
  pythonState: 'python-state',
  setupPython: 'setup-python',
  pythonLog: 'python-log',
  openNotebook: 'open-notebook',
  newNotebook: 'new-notebook',
  createProject: 'create-project',
  openProject: 'open-project',
  projectsFolder: 'projects-folder',
  chooseProjectsFolder: 'choose-projects-folder',
  openRecent: 'open-recent',
  recentNotebooks: 'recent-notebooks',
  readBrief: 'read-brief',
  writeBrief: 'write-brief',
  listFiles: 'list-files',
  revealFolder: 'reveal-folder',
  attachFiles: 'attach-files',
  saveNotebook: 'save-notebook',
  checkPins: 'check-pins',
  renameNotebook: 'rename-notebook',
  confirmDiscard: 'confirm-discard',
  restoreSession: 'restore-session',
  saveDraft: 'save-draft',
  documentState: 'document-state',
  menu: 'menu',
  /** Sent by the preload when the page subscribes to menu actions, so the main process knows it can send one. */
  menuReady: 'menu-ready',
  getProviderKeys: 'get-provider-keys',
  setProviderKey: 'set-provider-key',
  getUpdate: 'get-update',
  downloadUpdate: 'download-update',
  updateFound: 'update-found',
} as const
