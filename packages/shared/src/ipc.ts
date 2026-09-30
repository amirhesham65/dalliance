import type { Correction, CreatedVariable, Notebook, Output, Provenance } from './notebook'

/** One line in a cell's activity log: what the agent did while writing the cell. */
export interface ActivityItem {
  id: string
  /** Plain words, never code. */
  label: string
  detail?: string
  /** The Python an explore or run_cell call sent, shown when the user opens the step. */
  code?: string
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
  /** The model that answered. It can differ from the chosen one, after a fallback. */
  modelId: string | null
  /** Whether the chosen model declined the call and a fallback model answered it instead. */
  fallback: boolean
  /** The model's reasoning summary for this call. Null when it returned none, never left out. */
  reasoning: string | null
  /** The tokens the call used. */
  usage: StepUsage
  /** The gateway's id for the call, which Dalliance Cloud bills by. Null from the Anthropic API. */
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
 * What a run's model calls cost, when Show costs is on. See docs/agent-harness.md.
 * - `usd`: on the user's own key, estimated from the tokens and list prices. `unpricedTokens` are the tokens of
 *   calls to a model with no known price, which are left out of `usd` rather than guessed.
 * - `credits`: on Dalliance Cloud, which counts them after each call. The renderer asks for them by generation id
 *   through `countCredits()`. `tokens` is what the calls used, for when the credits never arrive.
 */
export type RunCost =
  | { unit: 'usd'; usd: number; unpricedTokens: number }
  | { unit: 'credits'; generationIds: string[]; tokens: number }

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

/** A provider the user brings a key for. */
export type KeyProvider = 'gateway' | 'anthropic'
/**
 * Where models run: on the user's own key, or on their Dalliance account through Dalliance Cloud. `cloud` is only
 * offered in builds that have a Cloud URL. See docs/cloud.md.
 */
export type Provider = KeyProvider | 'cloud'
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
  /** Whether the Activity pane shows what each run cost, and the notebook's total. Off by default. */
  showCosts: boolean
  /** True once the first-run setup was finished or skipped. */
  onboarded: boolean
  /** Where the key for the chosen provider comes from: Settings, the app's environment, the user's shell profile, or nowhere. */
  keySource: 'settings' | 'environment' | 'shell' | null
  hasKey: Record<KeyProvider, boolean>
  /**
   * Providers whose saved key is there but can't be decrypted, usually because an update changed the app's
   * keychain identity. The user has to paste it again. Optional so older views and test fixtures still type.
   */
  unreadableKeys?: KeyProvider[]
  /**
   * How each provider's key is kept: the saved key's form, or for no saved key, how a new one would be saved.
   * `plain` means settings.json holds it unencrypted because the system has no keychain.
   */
  keyStorage?: Record<KeyProvider, KeyStorage>
  /** True when this build has Dalliance Cloud, so `cloud` can be chosen and Settings shows the account. */
  cloud: boolean
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
  showCosts?: boolean
  onboarded?: boolean
  /** Set a key for a provider. An empty string removes it. */
  apiKey?: { provider: KeyProvider; key: string }
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

/** A plan Dalliance Cloud sells. Mirrors what `billing:plans` returns in the dalliance-cloud repo. */
export interface PlanOption {
  key: 'pro'
  name: string
  description: string | null
  /** Like "$20 / month". */
  price: string | null
  /** The credits included each billing period. */
  credits: number | null
}

/** The signed-in user's subscription. Mirrors `billing:status` in the dalliance-cloud repo. */
export interface SubscriptionView {
  /** Which plan it is, when it's one on offer. */
  key: string | null
  name: string
  /** `active`, `trialing`, `past_due`, `canceled` and the like. */
  status: string
  price: string | null
  /** When the period ends: the renewal date, or the last day when it's cancelling. ISO. */
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

/** The plan, as the renderer sees it. The main process talks to Dalliance Cloud. */
export interface BillingView {
  /** False when this build has no Dalliance Cloud. */
  available: boolean
  plans: PlanOption[]
  /** Null when signed out or without a plan. */
  subscription: SubscriptionView | null
  /** Credits used this billing period, against what the plan includes. Null without a plan. */
  usage: { spentCredits: number; planCredits: number | null } | null
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
  /** Ask the provider whether a key works, without saving it. */
  checkKey(provider: KeyProvider, key: string): Promise<KeyCheck>
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
  saveNotebook(path: string | null, notebook: Notebook): Promise<string | null>
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
  startCheckout(plan: PlanOption['key']): Promise<BillingView>
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
