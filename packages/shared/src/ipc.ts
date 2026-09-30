import type { Correction, CreatedVariable, Notebook, Output } from './notebook'

/** One line in a cell's activity log: what the agent did while writing the cell. */
export interface ActivityItem {
  id: string
  label: string
  detail?: string
  status: 'running' | 'done' | 'error'
}

export type RunEvent =
  | { type: 'status'; text: string }
  | { type: 'activity'; item: ActivityItem }
  /** A new attempt at running the cell starts. Clear the live outputs. */
  | { type: 'attempt'; code: string }
  | { type: 'output'; output: Output }
  | { type: 'question'; requestId: string; question: string; options: string[] }
  | { type: 'approval'; requestId: string; title: string; detail: string }
  /** A short name for the cell arrived. It can land before or after the run ends. */
  | { type: 'title'; title: string; prompt: string }

export interface RunCellRequest {
  cellId: string
  prompt: string
  code: string
  /** True when the agent must write the code. False to run the existing code directly. */
  generate: boolean
  corrections: Correction[]
  /** Ask the small model for a title while the cell runs. */
  nameIt?: boolean
  previousCells: { kind: 'prompt' | 'note'; text: string; code?: string }[]
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
  /** Why the run failed, when the problem was not a Python error (no API key, stopped, the agent gave up). */
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

export type Provider = 'gateway' | 'anthropic'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface SettingsView {
  provider: Provider
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  /** Whether a small model names cells for the outline. */
  autoTitles: boolean
  /** Whether the agent proposes follow-up prompts under a finished cell. */
  suggestNext: boolean
  /** True once the first-run setup was finished or skipped. */
  onboarded: boolean
  /** Where the key for the chosen provider comes from: Settings, the app's environment, the user's shell profile, or nowhere. */
  keySource: 'settings' | 'environment' | 'shell' | null
  hasKey: Record<Provider, boolean>
  /**
   * Providers whose saved key is there but can't be decrypted, usually because an update changed the app's
   * keychain identity. The user has to paste it again. Optional so older views and test fixtures still type.
   */
  unreadableKeys?: Provider[]
  /**
   * How each provider's key is kept: the saved key's form, or for no saved key, how a new one would be saved.
   * `plain` means settings.json holds it unencrypted because the system has no keychain.
   */
  keyStorage?: Record<Provider, KeyStorage>
}

export type KeyStorage = 'keychain' | 'plain'

export interface SettingsUpdate {
  provider?: Provider
  model?: string
  effort?: Effort
  pythonPath?: string | null
  approvalMode?: 'interactive' | 'background'
  autoTitles?: boolean
  suggestNext?: boolean
  onboarded?: boolean
  /** Set a key for a provider. An empty string removes it. */
  apiKey?: { provider: Provider; key: string }
}

/** A model the chosen provider can run, for the model picker. */
export interface ModelOption {
  id: string
  name: string
  /** Who makes the model, like Anthropic or OpenAI. */
  maker: string
  description?: string
  /** Price per million input and output tokens, when the provider says. */
  price?: string
}

/** What the provider said about a key before it was saved. */
export interface KeyCheck {
  /** `unchecked` when the provider couldn't be reached, so the key may still be fine. */
  status: 'ok' | 'rejected' | 'unchecked'
  /** The credit balance when the key works and the provider has one, otherwise why it failed. */
  detail: string | null
}

export interface ModelList {
  provider: Provider
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
/** What renaming a notebook came to: its new path, or why it couldn't be. */
export type RenameResult = { path: string; /** True when the notebook had no file, so the rename wrote it. */ saved: boolean } | { error: string }

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

export interface OpenedNotebook {
  path: string | null
  notebook: Notebook
}

/** What the renderer tells the main process about its notebook, for the tab strip and the window title. */
export interface DocumentState {
  path: string | null
  dirty: boolean
  /** Whether a cell is queued or running. Optional so older callers still type. */
  running?: boolean
}

/** One tab in the window, as the tab strip draws it. */
export interface TabInfo {
  id: string
  /** The notebook's file name without .ipynb, or Untitled. */
  title: string
  path: string | null
  dirty: boolean
  running: boolean
}

/** Every tab in the window, in order, which one is showing, and which one is the page that receives this. */
export interface TabsState {
  tabs: TabInfo[]
  activeId: string | null
  selfId: string | null
}

export type MenuAction =
  | 'new'
  | 'open'
  | 'open-folder'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'run-cell'
  | 'run-all'
  | 'interrupt'
  | 'restart'
  | 'settings'
  | 'add-prompt'
  | 'add-note'
  | 'toggle-sidebar'
  | 'welcome'
  | `pane-${PaneName}`

/** The side panes, as the menu names them. */
export type PaneName = 'brief' | 'variables' | 'history' | 'files' | 'pinned' | 'activity'

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
  /** Ask the provider whether a key works, without saving it. */
  checkKey(provider: Provider, key: string): Promise<KeyCheck>
  updateSettings(update: SettingsUpdate): Promise<SettingsView>
  pythonState(): Promise<PythonState>
  setupPython(): Promise<PythonState>
  onPythonLog(listener: (line: string) => void): () => void
  /**
   * The open calls below all place the notebook the same way. It opens in the calling tab when that tab is an
   * untouched Untitled, and the result is the notebook for it to load. Otherwise it opens in a new tab, or the tab
   * that already has the file comes forward, and the result is null, as it is for a cancel or a failure.
   */
  openNotebook(): Promise<OpenedNotebook | null>
  /** Writes a new notebook file into the folder in use, so it has a path from the start, on a fresh kernel. Null when the folder can't be written to, after the reason is shown. */
  newNotebook(notebook: Notebook): Promise<OpenedNotebook | null>
  /** Asks for a folder, an existing one or a new one made in the dialog, and starts a notebook file in it. Null when cancelled, or when the folder can't be written to. */
  openFolder(notebook: Notebook): Promise<OpenedNotebook | null>
  openRecent(path: string): Promise<OpenedNotebook | null>
  recentNotebooks(): Promise<RecentNotebook[]>
  readBrief(): Promise<Brief>
  writeBrief(text: string): Promise<Brief>
  listFiles(): Promise<FileEntry[]>
  /**
   * Renames the open notebook's file, as Jupyter does. A notebook without a file is written under that name in the
   * folder in use. Unsaved edits stay unsaved. The name is checked, and a taken one comes back as an error.
   */
  renameNotebook(current: string | null, name: string, notebook: Notebook): Promise<RenameResult>
  saveNotebook(path: string | null, notebook: Notebook): Promise<string | null>
  restoreSession(): Promise<RestoredSession | RestoreFailure | null>
  saveDraft(state: DraftState): void
  setDocumentState(state: DocumentState): void
  onMenu(listener: (action: MenuAction) => void): () => void
  /** Settings changed, from any tab. Every page gets the new view. */
  onSettingsChanged(listener: (view: SettingsView) => void): () => void
  /** The Python changed for the whole app: set up, or a new path in Settings. */
  onPythonState(listener: (state: PythonState) => void): () => void
  /** The window's tabs as they are now. */
  listTabs(): Promise<TabsState>
  /** The tabs, whenever one opens, closes, switches, or changes name, unsaved changes or running cells. */
  onTabs(listener: (state: TabsState) => void): () => void
  /** Opens a tab on the start page and shows it. */
  newTab(): Promise<void>
  /** Closes a tab, asking to save it first when it has unsaved changes. The last tab closes the window. */
  closeTab(id: string): Promise<void>
  switchTab(id: string): Promise<void>
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
  checkKey: 'check-key',
  updateSettings: 'update-settings',
  pythonState: 'python-state',
  setupPython: 'setup-python',
  pythonLog: 'python-log',
  openNotebook: 'open-notebook',
  newNotebook: 'new-notebook',
  openFolder: 'open-folder',
  openRecent: 'open-recent',
  recentNotebooks: 'recent-notebooks',
  readBrief: 'read-brief',
  writeBrief: 'write-brief',
  listFiles: 'list-files',
  saveNotebook: 'save-notebook',
  renameNotebook: 'rename-notebook',
  restoreSession: 'restore-session',
  saveDraft: 'save-draft',
  documentState: 'document-state',
  menu: 'menu',
  /** Sent by the preload when the page subscribes to menu actions, so the main process knows it can send one. */
  menuReady: 'menu-ready',
  settingsChanged: 'settings-changed',
  pythonStateChanged: 'python-state-changed',
  listTabs: 'list-tabs',
  tabsChanged: 'tabs-changed',
  newTab: 'new-tab',
  closeTab: 'close-tab',
  switchTab: 'switch-tab',
} as const
