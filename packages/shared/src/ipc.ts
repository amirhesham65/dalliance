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
  /** True once the first-run setup was finished or skipped. */
  onboarded: boolean
  /** Where the key for the chosen provider comes from, or null if there is none. */
  keySource: 'settings' | 'environment' | null
  hasKey: Record<Provider, boolean>
}

export interface SettingsUpdate {
  provider?: Provider
  model?: string
  effort?: Effort
  pythonPath?: string | null
  approvalMode?: 'interactive' | 'background'
  autoTitles?: boolean
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

export interface ModelList {
  provider: Provider
  models: ModelOption[]
  error: string | null
}

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

export interface OpenedNotebook {
  path: string | null
  notebook: Notebook
}

export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
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
  onKernelState(listener: (state: KernelState) => void): () => void
  getSettings(): Promise<SettingsView>
  listModels(): Promise<ModelList>
  updateSettings(update: SettingsUpdate): Promise<SettingsView>
  pythonState(): Promise<PythonState>
  setupPython(): Promise<PythonState>
  onPythonLog(listener: (line: string) => void): () => void
  openNotebook(): Promise<OpenedNotebook | null>
  openRecent(path: string): Promise<OpenedNotebook | null>
  recentNotebooks(): Promise<RecentNotebook[]>
  readBrief(): Promise<Brief>
  writeBrief(text: string): Promise<Brief>
  listFiles(): Promise<FileEntry[]>
  saveNotebook(path: string | null, notebook: Notebook): Promise<string | null>
  confirmDiscard(): Promise<boolean>
  restoreSession(): Promise<RestoredSession | null>
  saveDraft(state: DraftState): void
  setDocumentState(state: { path: string | null; dirty: boolean }): void
  onMenu(listener: (action: MenuAction) => void): () => void
}

export const IPC = {
  runCell: 'run-cell',
  runEvent: 'run-event',
  respond: 'respond',
  interrupt: 'interrupt',
  restartKernel: 'restart-kernel',
  kernelState: 'kernel-state',
  listVariables: 'list-variables',
  kernelStateChanged: 'kernel-state-changed',
  getSettings: 'get-settings',
  listModels: 'list-models',
  updateSettings: 'update-settings',
  pythonState: 'python-state',
  setupPython: 'setup-python',
  pythonLog: 'python-log',
  openNotebook: 'open-notebook',
  openRecent: 'open-recent',
  recentNotebooks: 'recent-notebooks',
  readBrief: 'read-brief',
  writeBrief: 'write-brief',
  listFiles: 'list-files',
  saveNotebook: 'save-notebook',
  confirmDiscard: 'confirm-discard',
  restoreSession: 'restore-session',
  saveDraft: 'save-draft',
  documentState: 'document-state',
  menu: 'menu',
} as const
