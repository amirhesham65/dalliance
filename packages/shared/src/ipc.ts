import type { PlanKey, PlanOption, PlanUsage, SubscriptionView } from './cloud'
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
   * A short name for the cell arrived. It can land before or after the run ends. With Show costs on, `cost` is
   * what naming it cost, which counts toward the notebook's total.
   */
  | { type: 'title'; title: string; prompt: string; cost?: RunCost }

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
  /** The gateway's id for the call, which Dalliance Cloud bills by. Null when the gateway sent none. */
  generationId: string | null
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

/**
 * What a run's model calls cost, for Show costs. See docs/agent-harness.md. Dalliance Cloud counts the credits after
 * each call, so the run only names its calls; the renderer asks for the credits by generation id through
 * `countCredits()`. `tokens` is what the calls used, for when the credits never arrive.
 */
export interface RunCost {
  generationIds: string[]
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
  /** What the model calls cost. Only with Show costs on, and only for a run that called a model. */
  cost?: RunCost
  /** How a generated run made the code. Absent for a plain run of saved code, which keeps the cell's record. */
  provenance?: Provenance | null
  /** Why the run failed, when the problem was not a Python error (signed out, stopped, the agent gave up). */
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
  /** A gateway id like `anthropic/claude-sonnet-5.5`. Models run on Dalliance Cloud. See docs/cloud.md. */
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  /** Whether a small model names cells for the outline. */
  autoTitles: boolean
  /** Whether the agent proposes follow-up prompts under a finished cell. */
  suggestNext: boolean
  /** Whether the Activity pane shows what each run cost, and the notebook's total. Off by default. */
  showCosts: boolean
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
  showCosts?: boolean
  onboarded?: boolean
}

/** A model Dalliance Cloud runs, for the model picker. */
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
  | 'verify'
  | 'settings'
  | 'add-prompt'
  | 'add-note'
  | 'toggle-sidebar'
  | 'welcome'
  | `pane-${PaneName}`

/** The side panes, as the menu names them. */
export type PaneName = 'brief' | 'variables' | 'history' | 'files' | 'pinned' | 'activity'

/** The Dalliance account, as the renderer sees it. The session itself stays in the main process. */
export interface AccountView {
  /** Null when signed out. */
  user: { name: string; email: string } | null
  /** True until the first answer about the stored session. */
  checking: boolean
  /** True while the sign-in page is open in the browser, so the renderer can offer the code field. */
  waiting: boolean
  /** Why the account couldn't be checked or a code didn't work. The last known user stays. */
  error: string | null
}

/** The plan, as the renderer sees it. The main process talks to Dalliance Cloud. */
export interface BillingView {
  plans: PlanOption[]
  /** Null when signed out or without a plan. */
  subscription: SubscriptionView | null
  /** Credits used this billing period, against what the plan includes. Null without a plan. */
  usage: PlanUsage | null
  /** True until the first answer from Dalliance Cloud. */
  loading: boolean
  /** True once checkout opened in the browser, until a plan arrives. */
  checkingOut: boolean
  error: string | null
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
  getAccount(): Promise<AccountView>
  /** Opens the sign-in page in the browser. */
  signIn(): Promise<AccountView>
  /** Redeems the code the sign-in page shows when the browser couldn't open the app. */
  redeemSignInCode(code: string): Promise<AccountView>
  signOut(): Promise<AccountView>
  onAccount(listener: (account: AccountView) => void): () => void
  getBilling(): Promise<BillingView>
  /** Opens checkout for a plan in the browser. */
  startCheckout(plan: PlanKey): Promise<BillingView>
  /** Opens the billing portal in the browser: invoices, the card, cancelling. */
  openBillingPortal(): Promise<BillingView>
  onBilling(listener: (billing: BillingView) => void): () => void
  /**
   * The credits Dalliance Cloud counted for these calls, waiting until every one has landed or 90 seconds pass.
   * Null when none were counted, or in builds without Dalliance Cloud.
   */
  countCredits(generationIds: string[]): Promise<number | null>
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
  openFolder: 'open-folder',
  openRecent: 'open-recent',
  recentNotebooks: 'recent-notebooks',
  readBrief: 'read-brief',
  writeBrief: 'write-brief',
  listFiles: 'list-files',
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
  getAccount: 'get-account',
  signIn: 'sign-in',
  redeemSignInCode: 'redeem-sign-in-code',
  signOut: 'sign-out',
  accountChanged: 'account-changed',
  getBilling: 'get-billing',
  startCheckout: 'start-checkout',
  openBillingPortal: 'open-billing-portal',
  billingChanged: 'billing-changed',
  countCredits: 'count-credits',
} as const
