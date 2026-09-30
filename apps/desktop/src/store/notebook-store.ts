import { create } from 'zustand'
import { cellTitle } from '@/lib/notebook/text'
import type {
  AccountView,
  ActivityItem,
  BillingView,
  Brief,
  CellRunResult,
  KernelState,
  DallianceApi,
  EnvironmentView,
  ModelList,
  PaneName,
  PythonState,
  RunCellRequest,
  RunCost,
  RunEvent,
  SettingsView,
  VariableView,
} from '@dalliance/shared/ipc'
import {
  type Cell,
  type CreatedVariable,
  type Notebook,
  type Output,
  type PromptCell,
  MAX_REVISIONS,
  MIN_TITLE_PROMPT,
  needsGeneration,
  newNoteCell,
  tablesOpen,
  newPromptCell,
} from '@dalliance/shared/notebook'
import { type MissingNameCause, type SeedWarning, compareOutputs, missingName, missingNameCause, seedWarnings } from '@dalliance/shared/verify'

/** What a cell shows while it is queued or running. Not saved with the notebook. */
export interface CellRun {
  status: 'queued' | 'running'
  statusText: string
  activity: ActivityItem[]
  liveOutputs: Output[]
  liveCode: string | null
  question: { requestId: string; question: string; options: string[] } | null
  approval: { requestId: string; title: string; detail: string } | null
  startedAt: number
}

/** One line in the notebook's run log. Not saved with the notebook. */
export interface LogEntry {
  id: number
  at: number
  kind: 'wrote' | 'ran' | 'failed' | 'stopped' | 'restarted' | 'restored' | 'verified'
  text: string
  cellId?: string
  /** What the run's model calls cost, with Show costs on. */
  cost?: CostView
}

/** A run's cost as the Activity pane shows it. Credits are `counting` until Dalliance Cloud has them all. */
export type CostView =
  | { unit: 'usd'; usd: number; unpricedTokens: number }
  | { unit: 'credits'; credits: number | null; tokens: number; counting: boolean }

/**
 * What the open notebook's model calls have cost since it was opened, cell names included. `unpricedTokens` are
 * tokens with no known price, and Cloud calls whose credits never arrived. `counting` is how many runs' credits
 * are still on their way.
 */
export interface Spend {
  usd: number
  credits: number
  unpricedTokens: number
  counting: number
}

export const NO_SPEND: Spend = { usd: 0, credits: 0, unpricedTokens: 0, counting: 0 }

/** A short message at the bottom of the window, with an Undo when the change can be taken back. Not saved. */
export interface Notice {
  id: number
  text: string
  tone: 'info' | 'error'
  undo?: () => void
}

/**
 * Where one prompt cell stands in a Verify run. `waiting` until its rerun ends, then `same`, `figure` (text and
 * tables match, a figure doesn't), `changed` or `failed`. `stopped` when Stop cut its run short, `not-run` when
 * Verify ended before it, and `no-code` for a cell with no code to run.
 */
export type VerifyStatus = 'waiting' | 'same' | 'figure' | 'changed' | 'failed' | 'stopped' | 'not-run' | 'no-code'

/** One prompt cell in the Verify report. Not saved with the notebook. */
export interface VerifyCell {
  id: string
  /** The cell's number, counting prompt cells as the overview does. */
  number: number
  status: VerifyStatus
  /** The code as it was when Verify started, which is what reruns. */
  code: string
  /** The outputs the notebook had when Verify started. Verify never changes them. */
  saved: Output[]
  /** The rerun's outputs, once it has ended. */
  fresh: Output[] | null
  executionCount: number | null
  durationMs: number
  variables: CreatedVariable[]
  /** Why the rerun failed when it wasn't a Python error, like a kernel that didn't start. */
  error: string | null
  /** The name a NameError was about, and why nothing defined it. */
  missing: { name: string; cause: MissingNameCause } | null
  /** Random calls in the code that no seed fixes. Read from the code, so they show before the rerun ends. */
  seeds: SeedWarning[]
}

/**
 * A Verify run: restart Python, rerun every prompt cell's saved code top to bottom, and compare. `stopping`
 * means Stop was pressed and the running cell hasn't answered yet. Not saved with the notebook.
 */
export interface VerifyReport {
  phase: 'restarting' | 'running' | 'stopping' | 'done' | 'stopped' | 'failed'
  /** Why Python couldn't restart, when the phase is `failed`. */
  error: string | null
  cells: VerifyCell[]
}

/** The confirmation Verify asks for before it restarts Python. */
export const VERIFY_CONFIRMATION = 'Verify restarts Python and re-runs every cell. Variables you created outside cells will be cleared.'

/** The side panes, one open at a time. Cmd+1 to Cmd+6 open them in this order. */
export type PaneKind = PaneName
export type VariablesView = 'variables' | 'environment'
export const PANE_ORDER: PaneKind[] = ['brief', 'variables', 'history', 'files', 'pinned', 'activity']

export interface NotebookState {
  /** The start page, or the open notebook. The notebook stays loaded behind the start page. */
  screen: 'welcome' | 'notebook'
  /** Whether the start page was opened over a notebook, so it can go back to it. */
  canReturn: boolean
  notebook: Notebook
  path: string | null
  dirty: boolean
  selectedId: string | null
  runs: Record<string, CellRun>
  /** The activity log of each cell's last generation, shown under the cell. */
  activity: Record<string, ActivityItem[]>
  /** Run failures that are not Python errors: no key, stopped, the agent gave up. */
  messages: Record<string, string>
  kernel: KernelState
  variables: VariableView[]
  /** The Python's libraries, once the environment view has asked. Null until then. */
  environment: EnvironmentView | null
  environmentLoading: boolean
  /** Something may have changed the libraries while the environment view was hidden, so it reads them again when shown. */
  environmentStale: boolean
  /** Which view the Variables & Environment pane shows. */
  variablesView: VariablesView
  settings: SettingsView | null
  /** The Dalliance account and its plan, in builds with Dalliance Cloud. Null until the main process answers. */
  account: AccountView | null
  billing: BillingView | null
  /** The Settings section on screen, or null when Settings is closed. It covers whatever screen is under it. */
  settingsPage: SettingsSection | null
  python: PythonState | null
  /** A cell whose editor should take keyboard focus on its next render. */
  focusId: string | null
  /** What happened in this session, newest first. */
  log: LogEntry[]
  /** What this notebook's runs cost, when Show costs is on. Clearing the log keeps it. */
  spend: Spend
  /** The cell that most recently finished running, which shows its suggested next prompts. */
  lastFinishedId: string | null
  pane: PaneKind | null
  /** Cells whose results are pinned in the side pane, in the order they were pinned. */
  pinnedIds: string[]
  brief: Brief | null
  /** What the model picker offers. Loaded when the picker first opens. */
  models: ModelList | null
  /** The message showing at the bottom of the window, if any. */
  notice: Notice | null
  /** The last Verify run's report, until it's closed or another notebook loads. */
  verify: VerifyReport | null
  /** Whether Verify's confirmation is showing. */
  verifyAsking: boolean
}

let api: DallianceApi | undefined = typeof window === 'undefined' ? undefined : window.dalliance

/** Tests and the browser preview swap in a fake bridge. */
export function setApi(next: DallianceApi | undefined) {
  api = next
}
export const getApi = () => api

export function welcomeNotebook(): Notebook {
  return {
    cells: [
      newNoteCell(
        '# Untitled notebook\nWrite what you want to compute in plain language. Press Shift+Enter to run a cell. The code it writes is one tab away and you can edit it.',
      ),
      newPromptCell(''),
    ],
  }
}

const initial = welcomeNotebook()

/** The sections of Settings, in the order the side list shows them. */
export const SETTINGS_SECTIONS = ['models', 'agent', 'python', 'account'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

// Settings reopens where it was left
let lastSettingsPage: SettingsSection = 'models'

export const useNotebook = create<NotebookState>(() => ({
  screen: 'notebook',
  canReturn: false,
  notebook: initial,
  path: null,
  dirty: false,
  selectedId: initial.cells[1].id,
  runs: {},
  activity: {},
  messages: {},
  kernel: { status: 'dead', python: null, cwd: '', error: null },
  variables: [],
  environment: null,
  environmentLoading: false,
  environmentStale: false,
  variablesView: 'variables',
  settings: null,
  account: null,
  billing: null,
  settingsPage: null,
  python: null,
  focusId: null,
  log: [],
  spend: NO_SPEND,
  lastFinishedId: null,
  pane: null,
  pinnedIds: [],
  brief: null,
  models: null,
  notice: null,
  verify: null,
  verifyAsking: false,
}))

const MAX_LOG = 60
let logId = 0

function addLog(entry: Omit<LogEntry, 'id' | 'at'>): number {
  const id = ++logId
  set((s) => ({ log: [{ ...entry, id, at: Date.now() }, ...s.log].slice(0, MAX_LOG) }))
  return id
}

// Bumped when a notebook loads, so credits counted for the last one don't land in this one's total
let spendEpoch = 0

/**
 * Add a cost to the notebook's total and, for a run, to its log entry. Dalliance Cloud's credits are counted by
 * the service a few seconds after each call, so they're asked for here and show as counting until they arrive.
 */
function trackCost(cost: RunCost | undefined, entryId: number | null) {
  if (!cost) return
  if (cost.unit === 'usd') {
    set((s) => ({ spend: { ...s.spend, usd: s.spend.usd + cost.usd, unpricedTokens: s.spend.unpricedTokens + cost.unpricedTokens } }))
    return
  }
  const epoch = spendEpoch
  set((s) => ({ spend: { ...s.spend, counting: s.spend.counting + 1 } }))
  const counted = api && cost.generationIds.length ? api.countCredits(cost.generationIds).catch(() => null) : Promise.resolve(null)
  void counted.then((credits) => {
    if (epoch !== spendEpoch) return
    set((s) => ({
      spend: {
        ...s.spend,
        counting: s.spend.counting - 1,
        credits: s.spend.credits + (credits ?? 0),
        // Credits that never came: the tokens are all there is to show
        unpricedTokens: s.spend.unpricedTokens + (credits == null ? cost.tokens : 0),
      },
      log: s.log.map((e) => (e.id === entryId && e.cost?.unit === 'credits' ? { ...e, cost: { ...e.cost, credits, counting: false } } : e)),
    }))
  })
}

function costView(cost: RunCost | undefined): CostView | undefined {
  if (!cost) return undefined
  return cost.unit === 'usd' ? cost : { unit: 'credits', credits: null, tokens: cost.tokens, counting: true }
}

const NOTICE_MS = 6000
let noticeId = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

/** What went wrong, without the wrapper Electron puts around errors thrown in the main process. */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}

const quoted = (cell: Cell) => `“${cellTitle(cell, 40)}”`

const set = useNotebook.setState
const get = useNotebook.getState

function updateCells(fn: (cells: Cell[]) => Cell[]) {
  set((s) => ({ notebook: { ...s.notebook, cells: fn(s.notebook.cells) }, dirty: true }))
}

function updateCell(id: string, fn: (cell: Cell) => Cell) {
  updateCells((cells) => cells.map((c) => (c.id === id ? fn(c) : c)))
}

function hasRun(cell: PromptCell) {
  return cell.executionCount != null || cell.outputs.length > 0 || cell.state === 'error'
}

const findCell = (id: string) => get().notebook.cells.find((c) => c.id === id)

function insertAt(cell: Cell, index: number) {
  updateCells((cells) => [...cells.slice(0, index), cell, ...cells.slice(index)])
  set({ selectedId: cell.id })
}

/** Take a cell out, stopping its run, and select the one that took its place. */
function removeCell(id: string): { cell: Cell; index: number } | null {
  const cells = get().notebook.cells
  const index = cells.findIndex((c) => c.id === id)
  if (index < 0) return null
  if (get().runs[id]?.status === 'running') {
    abandoned.add(id)
    void api?.interrupt()
  }
  removeFromQueue(id)
  updateCells((cs) => cs.filter((c) => c.id !== id))
  const rest = get().notebook.cells
  set({ selectedId: rest[Math.min(index, rest.length - 1)]?.id ?? null })
  return { cell: cells[index], index }
}

/** Swap a cell with its neighbour. False when there is none. */
function shiftCell(id: string, delta: -1 | 1): boolean {
  const cells = [...get().notebook.cells]
  const i = cells.findIndex((c) => c.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= cells.length) return false
  ;[cells[i], cells[j]] = [cells[j], cells[i]]
  updateCells(() => cells)
  return true
}

function putCell(cell: Cell) {
  updateCell(cell.id, () => cell)
}

/**
 * One notebook edit, recorded so Cmd+Z can take it back. Each is an operation on one cell, not a snapshot of
 * the notebook, so undoing it never touches other cells or rolls back a run.
 */
type Edit =
  | { type: 'insert'; cell: Cell; index: number }
  | { type: 'delete'; cell: Cell; index: number }
  | { type: 'move'; id: string; delta: -1 | 1 }
  /** A note or prompt switch: the whole cell before and after. */
  | { type: 'swap'; from: Cell; to: Cell }
  /** A correction or a restored revision: only the fields it changed. */
  | { type: 'fields'; id: string; from: Partial<PromptCell>; to: Partial<PromptCell> }

const MAX_EDITS = 100
const past: Edit[] = []
const future: Edit[] = []
/** The edit a showing notice's Undo button takes back. */
let noticeEdit: { edit: Edit; noticeId: number } | null = null

function record(edit: Edit) {
  past.push(edit)
  if (past.length > MAX_EDITS) past.shift()
  future.length = 0
  forgetNoticeEdit()
}

function clearEdits() {
  past.length = 0
  future.length = 0
  noticeEdit = null
}

/** A notice whose Undo takes back this edit, the same as Cmd+Z would. A later edit or undo retires it. */
function notifyUndoable(text: string, edit: Edit) {
  actions.notify(text, { undo: () => past[past.length - 1] === edit && actions.undo() })
  noticeEdit = { edit, noticeId: get().notice!.id }
}

function forgetNoticeEdit() {
  if (noticeEdit) actions.dismissNotice(noticeEdit.noticeId)
  noticeEdit = null
}

/** Record changed fields of a prompt cell and apply them. */
function changeFields(cell: PromptCell, to: Partial<PromptCell>): Edit {
  const from = Object.fromEntries(Object.keys(to).map((k) => [k, cell[k as keyof PromptCell]])) as Partial<PromptCell>
  putCell({ ...cell, ...to })
  const edit: Edit = { type: 'fields', id: cell.id, from, to }
  record(edit)
  return edit
}

function step(direction: 'undo' | 'redo'): boolean {
  const [source, target] = direction === 'undo' ? [past, future] : [future, past]
  while (source.length) {
    const edit = source.pop()!
    if (noticeEdit?.edit === edit) forgetNoticeEdit()
    const done = direction === 'undo' ? revert(edit) : reapply(edit)
    if (!done) continue // The notebook moved on, say the cell ran since: this edit can't be taken back, so drop it
    target.push(done)
    const id = done.type === 'move' || done.type === 'fields' ? done.id : done.type === 'swap' ? done.to.id : null
    if (id) set({ selectedId: id })
    return true
  }
  return false
}

/** Undo one edit. Returns the edit to redo it with, or null when the notebook no longer allows it. */
function revert(edit: Edit): Edit | null {
  switch (edit.type) {
    case 'insert': {
      // Keep what was typed into the cell, so Redo brings it back as it was
      const removed = removeCell(edit.cell.id)
      return removed && { type: 'insert', ...removed }
    }
    case 'delete':
      if (findCell(edit.cell.id)) return null
      insertAt(edit.cell, Math.min(edit.index, get().notebook.cells.length))
      return edit
    case 'move':
      return shiftCell(edit.id, edit.delta === 1 ? -1 : 1) ? edit : null
    case 'swap': {
      const done = swapCell(edit.to, edit.from)
      return done && { type: 'swap', from: done.to, to: done.from }
    }
    case 'fields':
      return setFields(edit.id, edit.to, edit.from) ? edit : null
  }
}

/** Redo one edit. Returns the edit to undo it with again, or null when the notebook no longer allows it. */
function reapply(edit: Edit): Edit | null {
  switch (edit.type) {
    case 'insert':
      if (findCell(edit.cell.id)) return null
      insertAt(edit.cell, Math.min(edit.index, get().notebook.cells.length))
      return edit
    case 'delete': {
      const removed = removeCell(edit.cell.id)
      return removed && { type: 'delete', ...removed }
    }
    case 'move':
      return shiftCell(edit.id, edit.delta) ? edit : null
    case 'swap':
      return swapCell(edit.from, edit.to)
    case 'fields':
      return setFields(edit.id, edit.from, edit.to) ? edit : null
  }
}

const textOf = (c: Cell) => (c.kind === 'note' ? c.markdown : c.prompt)

/**
 * Switch a cell that still looks like `expected` to `target`. Text typed since carries over, and a prompt
 * cell that ran since is left alone, so a switch back never throws a result away.
 */
function swapCell(expected: Cell, target: Cell): Extract<Edit, { type: 'swap' }> | null {
  const current = findCell(expected.id)
  if (!current || current.kind !== expected.kind) return null
  if (current.kind === 'prompt' && expected.kind === 'prompt' && (current.outputs !== expected.outputs || current.executionCount !== expected.executionCount))
    return null
  const text = textOf(current)
  let next = target
  if (text !== textOf(expected))
    next =
      target.kind === 'note'
        ? { ...target, markdown: text }
        : { ...target, prompt: text, state: hasRun(target) && target.state !== 'stale' ? 'edited' : target.state }
  putCell(next)
  return { type: 'swap', from: current, to: next }
}

/** Set fields on a prompt cell, only if the ones being replaced still hold what the edit left there. */
function setFields(id: string, expected: Partial<PromptCell>, next: Partial<PromptCell>): boolean {
  const cell = findCell(id)
  if (!cell || cell.kind !== 'prompt') return false
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
  if (!Object.entries(expected).every(([k, v]) => same(cell[k as keyof PromptCell], v))) return false
  putCell({ ...cell, ...next })
  return true
}

export const actions = {
  load(notebook: Notebook, path: string | null, dirty = false) {
    // A run from the last notebook must not land in this one. Stop it and drop what was queued; its result
    // names a cell this notebook doesn't have, so finish() ignores it
    queue.length = 0
    const running = Object.entries(get().runs).find(([, r]) => r.status === 'running')
    if (running) {
      abandoned.add(running[0])
      void api?.interrupt().catch(() => {})
    }
    clearEdits()
    spendEpoch++
    // A Verify run belongs to the last notebook
    verifyRuns.clear()
    verifyEpoch++
    set({
      screen: 'notebook',
      canReturn: false,
      notebook,
      path,
      dirty,
      selectedId: notebook.cells[0]?.id ?? null,
      runs: {},
      activity: {},
      messages: {},
      variables: [],
      log: [],
      spend: NO_SPEND,
      lastFinishedId: null,
      pinnedIds: [],
      pane: get().pane === 'pinned' ? null : get().pane,
      // An Undo from the last notebook must not reach into this one
      notice: null,
      verify: null,
      verifyAsking: false,
    })
    void actions.loadBrief()
  },

  /** The start page. From the menu it keeps the notebook to go back to; at launch there is none. */
  showWelcome(canReturn: boolean) {
    set({ screen: 'welcome', canReturn })
  },

  closeWelcome() {
    set({ screen: 'notebook', canReturn: false })
  },

  /** Settings, on the given section or the one it was last left on. */
  openSettings(section?: SettingsSection) {
    lastSettingsPage = section ?? lastSettingsPage
    set({ settingsPage: lastSettingsPage })
  },

  closeSettings() {
    set({ settingsPage: null })
  },

  /** The notebook file got a new name. Its edits are as saved or unsaved as they were, unless the rename wrote the file. */
  renamed(path: string, saved: boolean) {
    set(saved ? { path, dirty: false } : { path })
  },

  markSaved(path: string) {
    const moved = get().path !== path
    set({ path, dirty: false })
    // Save As into another folder means another AGENTS.md
    if (moved) void actions.loadBrief()
  },

  openPane(pane: PaneKind | null) {
    set({ pane })
  },

  togglePane(pane: PaneKind) {
    set((s) => ({ pane: s.pane === pane ? null : pane }))
  },

  /** Pin a cell's result to the side, or unpin it. Pinning opens the Pinned pane. */
  togglePin(id: string) {
    const pinned = get().pinnedIds.includes(id)
    set((s) => ({ pinnedIds: pinned ? s.pinnedIds.filter((p) => p !== id) : [...s.pinnedIds, id], ...(pinned ? {} : { pane: 'pinned' as const }) }))
  },

  clearLog() {
    set({ log: [] })
  },

  /** Show a message at the bottom of the window for a few seconds. With `undo`, it offers an Undo button. */
  notify(text: string, options: { undo?: () => void; tone?: Notice['tone'] } = {}) {
    const notice: Notice = { id: ++noticeId, text, tone: options.tone ?? 'info', undo: options.undo }
    set({ notice })
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => actions.dismissNotice(notice.id), NOTICE_MS)
  },

  /** A bridge call failed. Say what the user was trying to do and why it didn't work. */
  notifyFailure(what: string, err: unknown) {
    actions.notify(`${what}. ${errorText(err)}`, { tone: 'error' })
  },

  /** Hide the message, or only the given one so a newer message stays up. */
  dismissNotice(id?: number) {
    if (id == null || get().notice?.id === id) set({ notice: null })
  },

  async loadModels(force = false) {
    const { models, settings } = get()
    if (!api) return
    // A cached list is reused, but the saved model is still checked against it below
    const cached = !force && models && models.provider === settings?.provider && !models.error
    const list = cached ? models : await api.listModels().catch((err: unknown) => ({ provider: settings?.provider ?? 'gateway', models: [], error: String(err) }))
    if (!cached) set({ models: list })
    // Dalliance Cloud only offers models with zero data retention. A saved model it doesn't offer goes back to the
    // default (an empty model resets it), rather than failing every run
    const current = get().settings
    if (list.provider === 'cloud' && current?.provider === 'cloud' && !list.error && list.models.length && !list.models.some((m) => m.id === current.model)) {
      try {
        set({ settings: await api.updateSettings({ model: '' }) })
        actions.notify(`${current.model} isn't offered on Dalliance Cloud, so the model is back to the default.`)
      } catch (err) {
        actions.notifyFailure("Couldn't reset the model", err)
      }
    }
  },

  async loadBrief() {
    if (!api) return
    set({ brief: await api.readBrief().catch(() => null) })
  },

  /** Resolves true once AGENTS.md is written. A failure shows a message and resolves false. */
  async saveBrief(text: string): Promise<boolean> {
    if (!api) return false
    try {
      set({ brief: await api.writeBrief(text) })
      return true
    } catch (err) {
      actions.notifyFailure("Couldn't save the brief", err)
      return false
    }
  },

  /** A suggested prompt becomes the next cell and runs. */
  runSuggestion(afterId: string, prompt: string) {
    const cells = get().notebook.cells
    const index = cells.findIndex((c) => c.id === afterId)
    if (index < 0) return
    const next = cells[index + 1]
    // Reuse an empty prompt cell right below instead of stacking another one
    if (next?.kind === 'prompt' && !next.prompt.trim() && !next.code.trim()) {
      actions.setPrompt(next.id, prompt)
      set({ selectedId: next.id })
      actions.run(next.id)
      return
    }
    const cell = newPromptCell(prompt)
    insertAt(cell, index + 1)
    record({ type: 'insert', cell, index: index + 1 })
    actions.run(cell.id)
  },

  /** Bring back an earlier version of a cell. It runs its saved code on the next run, without the agent. */
  restoreRevision(id: string, at: number) {
    const cell = get().notebook.cells.find((c) => c.id === id)
    if (!cell || cell.kind !== 'prompt') return
    const rev = cell.history.find((r) => r.at === at)
    if (!rev) return
    changeFields(cell, {
      prompt: rev.prompt,
      code: rev.code,
      generatedFrom: rev.prompt,
      codeEdited: rev.edited,
      interpretation: rev.interpretation,
      answer: rev.answer,
      corrections: [],
      state: hasRun(cell) ? 'edited' : cell.state,
    })
    addLog({ kind: 'restored', text: `Restored an earlier version of ${quoted({ ...cell, prompt: rev.prompt })}`, cellId: id })
  },

  focus(id: string | null) {
    set({ focusId: id, ...(id ? { selectedId: id } : {}) })
  },

  select(id: string | null) {
    if (get().selectedId !== id) set({ selectedId: id })
  },

  setPrompt(id: string, prompt: string) {
    updateCell(id, (c) => (c.kind !== 'prompt' ? c : { ...c, prompt, state: hasRun(c) && c.state !== 'stale' ? 'edited' : c.state }))
  },

  setCode(id: string, code: string) {
    updateCell(id, (c) => (c.kind !== 'prompt' ? c : { ...c, code, codeEdited: true, state: hasRun(c) ? 'edited' : c.state }))
  },

  setNote(id: string, markdown: string) {
    updateCell(id, (c) => (c.kind === 'note' ? { ...c, markdown } : c))
  },

  /** The user changed one of the agent's stated assumptions. The next run regenerates with the correction. */
  correctAssumption(id: string, from: string, to: string) {
    const cell = get().notebook.cells.find((c) => c.id === id)
    if (!cell || cell.kind !== 'prompt' || !to.trim() || from === to) return
    changeFields(cell, {
      interpretation: cell.interpretation?.replace(`[[${from}]]`, `[[${to}]]`) ?? null,
      corrections: [...cell.corrections.filter((x) => x.to !== from), { from, to }],
      state: 'edited',
    })
  },

  insertCell(index: number, kind: 'prompt' | 'note'): string {
    const cell = kind === 'prompt' ? newPromptCell() : newNoteCell()
    insertAt(cell, index)
    record({ type: 'insert', cell, index })
    set({ focusId: cell.id })
    return cell.id
  },

  insertAfterSelected(kind: 'prompt' | 'note'): string {
    const { notebook, selectedId } = get()
    const index = notebook.cells.findIndex((c) => c.id === selectedId)
    return actions.insertCell(index < 0 ? notebook.cells.length : index + 1, kind)
  },

  /** Delete a cell, stopping it if it runs. The notice's Undo and Cmd+Z both take it back. */
  deleteCell(id: string): { cell: Cell; index: number } | null {
    const removed = removeCell(id)
    if (!removed) return null
    const edit: Edit = { type: 'delete', ...removed }
    record(edit)
    notifyUndoable('Cell deleted', edit)
    return removed
  },

  moveCell(id: string, delta: -1 | 1) {
    if (shiftCell(id, delta)) record({ type: 'move', id, delta })
  },

  /**
   * Make a cell a note or a prompt. A note keeps only the prompt's text, so turning a prompt cell that has
   * code, outputs or history into a note offers Undo, which puts the original cell back as it was.
   */
  setKind(id: string, kind: 'prompt' | 'note') {
    const before = get().notebook.cells.find((c) => c.id === id)
    if (!before || before.kind === kind) return
    if (before.kind === 'prompt') removeFromQueue(id)
    const after: Cell = before.kind === 'prompt' ? { ...newNoteCell(before.prompt), id: before.id } : { ...newPromptCell(before.markdown), id: before.id }
    putCell(after)
    const edit: Edit = { type: 'swap', from: before, to: after }
    record(edit)
    if (before.kind === 'prompt' && (before.code.trim() || before.outputs.length || before.history.length)) notifyUndoable('Made the cell a note', edit)
  },

  /**
   * Take back the last insert, delete, move, note or prompt switch, correction or restore. Text edits stay
   * with the text fields' own undo, and run results are never rolled back. Returns whether anything changed.
   */
  undo(): boolean {
    return step('undo')
  },

  /** Do again what undo took back. */
  redo(): boolean {
    return step('redo')
  },

  /** Fold or unfold a cell's tables. The choice is saved with the notebook. */
  toggleTables(id: string, open?: boolean) {
    updateCell(id, (c) => (c.kind === 'prompt' ? { ...c, showTables: open ?? !tablesOpen(c) } : c))
  },

  /** Make the next run rewrite the code from the prompt, even if the prompt hasn't changed. */
  regenerate(id: string) {
    updateCell(id, (c) => (c.kind === 'prompt' ? { ...c, generatedFrom: '', codeEdited: false } : c))
    actions.run(id)
  },

  run(id: string) {
    const cell = get().notebook.cells.find((c) => c.id === id)
    if (!cell || cell.kind !== 'prompt' || (!cell.prompt.trim() && !cell.code.trim())) return
    if (get().runs[id] || queue.includes(id)) return
    queue.push(id)
    set((s) => ({ runs: { ...s.runs, [id]: emptyRun('queued') } }))
    void pump()
  },

  runAll() {
    for (const c of get().notebook.cells) if (c.kind === 'prompt') actions.run(c.id)
  },

  async interrupt() {
    queue.length = 0
    stopVerify()
    set((s) => ({ runs: Object.fromEntries(Object.entries(s.runs).filter(([, r]) => r.status === 'running')) }))
    await api?.interrupt()
  },

  async restart() {
    await actions.interrupt()
    await restartPython()
  },

  /** Ask before Verify restarts Python. */
  askVerify() {
    if (!isVerifying()) set({ verifyAsking: true })
  },

  cancelVerify() {
    set({ verifyAsking: false })
  },

  /**
   * Check that the notebook runs from a clean start. Restart the tab's kernel, then rerun every prompt cell's
   * saved code top to bottom through the run queue, without the agent, and compare each result with the saved
   * one. The report is `verify`. Saved outputs and records stay as they were: a cell whose result came back the
   * same is marked up to date again, and `keepVerified()` is the only way new outputs replace saved ones.
   * Stop works as for any run, and leaves the report as far as it got.
   */
  async verify() {
    set({ verifyAsking: false })
    if (isVerifying()) return
    await actions.interrupt()
    try {
      await beforeVerify()
    } catch {
      // A check before Verify never stops it
    }
    const epoch = ++verifyEpoch
    const prompts = get().notebook.cells.filter((c): c is PromptCell => c.kind === 'prompt')
    const cells = prompts.map(
      (c, i): VerifyCell => ({
        id: c.id,
        number: i + 1,
        status: c.code.trim() ? 'waiting' : 'no-code',
        code: c.code,
        saved: c.outputs,
        fresh: null,
        executionCount: null,
        durationMs: 0,
        variables: [],
        error: null,
        missing: null,
        seeds: c.code.trim() ? seedWarnings(c.code, prompts.slice(0, i).map((p) => p.code)) : [],
      }),
    )
    set({ verify: { phase: 'restarting', error: null, cells } })
    const error = await restartPython()
    // Stopped while Python restarted, or another notebook loaded
    if (epoch !== verifyEpoch || get().verify?.phase !== 'restarting') return
    if (error) {
      setVerify((r) => ({ ...r, phase: 'failed', error, cells: r.cells.map((c) => (c.status === 'waiting' ? { ...c, status: 'not-run' } : c)) }))
      return
    }
    const waiting = cells.filter((c) => c.status === 'waiting')
    for (const c of waiting) {
      verifyRuns.set(c.id, c.code)
      if (!queue.includes(c.id)) queue.push(c.id)
    }
    set((s) => ({
      verify: s.verify && { ...s.verify, phase: 'running' },
      runs: { ...s.runs, ...Object.fromEntries(waiting.filter((c) => !s.runs[c.id]).map((c) => [c.id, emptyRun('queued')])) },
    }))
    settleVerify()
    void pump()
  },

  /** Put the report away. Not while Verify runs: Stop it first. */
  closeVerify() {
    if (!isVerifying()) set({ verify: null })
  },

  /**
   * Replace a cell's saved outputs with what Verify's rerun gave, for a cell that changed or whose figure
   * differs. Only while the cell still has the code that ran. Undo puts the saved outputs back.
   */
  keepVerified(id: string) {
    const entry = get().verify?.cells.find((c) => c.id === id)
    const cell = findCell(id)
    if (!entry?.fresh || (entry.status !== 'changed' && entry.status !== 'figure')) return
    if (!cell || cell.kind !== 'prompt' || cell.code !== entry.code) return
    const edit = changeFields(cell, {
      outputs: entry.fresh,
      executionCount: entry.executionCount,
      durationMs: entry.durationMs,
      variables: entry.variables,
      state: 'done',
    })
    notifyUndoable(`Kept the new outputs of cell ${entry.number}`, edit)
  },

  /** Shift+Enter: run this cell and move to the next one, adding a prompt cell at the end. */
  runAndAdvance(id: string) {
    actions.run(id)
    const cells = get().notebook.cells
    const index = cells.findIndex((c) => c.id === id)
    const next = cells[index + 1]
    if (next) set({ selectedId: next.id })
    else actions.insertCell(index + 1, 'prompt')
  },

  answer(id: string, requestId: string, answer: string | boolean | null) {
    api?.respond(requestId, answer)
    set((s) => {
      const run = s.runs[id]
      return run ? { runs: { ...s.runs, [id]: { ...run, question: null, approval: null } } } : {}
    })
  },

  dismissMessage(id: string) {
    set((s) => {
      const messages = { ...s.messages }
      delete messages[id]
      return { messages }
    })
  },

  applyRunEvent(id: string, event: RunEvent) {
    // A title can arrive after the run has ended, so it goes straight to the cell
    if (event.type === 'title') {
      // The cell may be gone, deleted or left behind in another notebook
      if (!get().notebook.cells.some((c) => c.id === id)) return
      updateCell(id, (c) => (c.kind === 'prompt' ? { ...c, title: event.title, titleFrom: event.prompt } : c))
      // Naming the cell counts toward the notebook's total, not the run's
      trackCost(event.cost, null)
      return
    }
    set((s) => {
      const run = s.runs[id]
      if (!run) return {}
      let next: CellRun = run
      switch (event.type) {
        case 'status':
          next = { ...run, statusText: event.text }
          break
        case 'activity': {
          const exists = run.activity.some((a) => a.id === event.item.id)
          next = { ...run, activity: exists ? run.activity.map((a) => (a.id === event.item.id ? event.item : a)) : [...run.activity, event.item] }
          break
        }
        case 'attempt':
          next = { ...run, liveOutputs: [], liveCode: event.code }
          break
        case 'output':
          next = { ...run, liveOutputs: [...run.liveOutputs, event.output] }
          break
        case 'question':
          next = { ...run, question: { requestId: event.requestId, question: event.question, options: event.options } }
          break
        case 'approval':
          next = { ...run, approval: { requestId: event.requestId, title: event.title, detail: event.detail } }
          break
      }
      return { runs: { ...s.runs, [id]: next } }
    })
  },

  async refreshVariables() {
    if (!api) return
    set({ variables: await api.listVariables() })
  },

  /**
   * Read the Python's libraries. A failure is kept as the view's error, so the pane can say what went wrong.
   * A call while a read is under way queues one more read after it, since the Python may have changed since the first began.
   */
  async loadEnvironment() {
    if (!api) return
    if (get().environmentLoading) {
      environmentAgain = true
      return
    }
    set({ environmentLoading: true, environmentStale: false })
    try {
      do {
        environmentAgain = false
        let environment: EnvironmentView
        try {
          environment = await api.listPackages()
        } catch (err) {
          environment = { python: null, version: null, packages: [], error: `Couldn't list the libraries: ${err instanceof Error ? err.message : String(err)}` }
        }
        // A read that was overtaken describes the Python as it was, so only the last one lands
        if (!environmentAgain) set({ environment })
      } while (environmentAgain)
    } finally {
      set({ environmentLoading: false })
    }
  },

  /** Switch the Variables & Environment pane between its two views. */
  showVariablesView(view: VariablesView) {
    set({ variablesView: view })
  },

  /**
   * A run, a restart or a new Python may have changed the libraries. Read them again if they're on screen.
   * Otherwise mark them stale, so the view reads them when it's next shown instead of spawning a Python nobody looks at.
   */
  environmentChanged() {
    const s = get()
    if (!s.environment) return
    if (s.pane === 'variables' && s.variablesView === 'environment') void actions.loadEnvironment()
    else set({ environmentStale: true })
  },
}

function emptyRun(status: CellRun['status']): CellRun {
  return { status, statusText: status === 'queued' ? 'Waiting' : 'Starting', activity: [], liveOutputs: [], liveCode: null, question: null, approval: null, startedAt: Date.now() }
}

const queue: string[] = []
let pumping = false
/** Set when loadEnvironment() is called during a read, so one more read follows it. */
let environmentAgain = false
/** Cells whose running result must be dropped when it arrives: deleted mid-run, or in a notebook since closed. */
const abandoned = new Set<string>()

function removeFromQueue(id: string) {
  const i = queue.indexOf(id)
  if (i >= 0) queue.splice(i, 1)
  // A cell deleted or made a note while Verify waits to rerun it
  if (get().runs[id]?.status !== 'running' && verifyRuns.delete(id)) {
    setVerifyCell(id, { status: 'not-run' })
    settleVerify()
  }
  set((s) => {
    if (s.runs[id]?.status !== 'queued') return {}
    const runs = { ...s.runs }
    delete runs[id]
    return { runs }
  })
}

/** Runs queued cells one at a time, in the order they were queued. */
async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const id = queue.shift()!
      const cells = get().notebook.cells
      const index = cells.findIndex((c) => c.id === id)
      const cell = cells[index]
      if (!cell || cell.kind !== 'prompt') {
        removeFromQueue(id)
        continue
      }
      // Verify reruns the code it started with, and never calls a model
      const verifyCode = verifyRuns.get(id)
      const verifying = verifyCode != null
      const generate = !verifying && needsGeneration(cell)
      set((s) => ({
        runs: { ...s.runs, [id]: { ...emptyRun('running'), statusText: generate ? 'Writing code' : verifying ? 'Verifying' : 'Running' } },
        messages: omit(s.messages, id),
      }))
      const request: RunCellRequest = {
        cellId: id,
        prompt: cell.prompt,
        code: verifyCode ?? cell.code,
        generate,
        // Any run names a cell that has no title for its current prompt, including reruns of saved code
        nameIt: !verifying && cell.prompt.trim().length >= MIN_TITLE_PROMPT && cell.titleFrom?.trim() !== cell.prompt.trim(),
        corrections: cell.corrections,
        previousCells: cells.slice(0, index).map((c) =>
          c.kind === 'note' ? { kind: 'note' as const, text: c.markdown } : { kind: 'prompt' as const, text: c.prompt, code: c.code },
        ),
      }
      const result: CellRunResult = api
        ? await api.runCell(request).catch((err: unknown) => failed(request, err))
        : failed(request, 'Running cells needs the desktop app.')
      // `cell` is the version sent. Edits made while the agent works are checked against it in finish()
      if (verifying) finishVerify(id, result)
      else finish(id, generate, result, cell)
    }
  } finally {
    pumping = false
  }
  void actions.refreshVariables().catch(() => {})
  // A cell may have installed a library
  actions.environmentChanged()
}

function failed(request: RunCellRequest, err: unknown): CellRunResult {
  return {
    ok: false,
    code: request.code,
    outputs: [],
    executionCount: null,
    durationMs: 0,
    generated: request.generate,
    interpretation: null,
    answer: null,
    suggestions: [],
    variables: [],
    activity: [],
    steps: [],
    error: err instanceof Error ? err.message : String(err),
  }
}

function finish(id: string, generate: boolean, result: CellRunResult, sent: PromptCell) {
  // The cell was deleted while it ran, or its notebook was closed. Even if Undo brought a cell with this id
  // back, the result belongs to a run that was stopped on its way out
  if (abandoned.delete(id)) {
    set((s) => ({ runs: omit(s.runs, id) }))
    return
  }
  const stopped = result.error === 'Stopped.'
  const entryId = logRun(get().notebook.cells.find((c) => c.id === id), generate, result)
  trackCost(result.cost, entryId)
  set((s) => {
    const cells = s.notebook.cells
    const index = cells.findIndex((c) => c.id === id)
    const cell = cells[index]
    const runs = omit(s.runs, id)
    if (!cell || cell.kind !== 'prompt') return { runs }

    // Nothing ran at all (no key, no Python, stopped before code ran): keep the cell as it was
    const nothingRan = result.executionCount == null && result.outputs.length === 0 && !result.ok
    // The user can keep typing while the agent works. Their edits win over the result, and the cell stays
    // `edited`, so the next run regenerates for the new prompt or runs their code
    const promptEdited = cell.prompt !== sent.prompt
    const codeEdited = cell.code !== sent.code
    const ran: PromptCell = {
      ...cell,
      prompt: sent.prompt,
      code: result.code,
      outputs: result.outputs,
      variables: result.ok ? result.variables : cell.variables,
      executionCount: result.executionCount,
      durationMs: result.durationMs,
      state: result.ok ? 'done' : 'error',
      ...(generate
        ? {
            // A failed generation leaves generatedFrom empty, so the next run tries again
            generatedFrom: result.ok ? sent.prompt : '',
            codeEdited: false,
            corrections: result.ok ? [] : cell.corrections,
            interpretation: result.ok ? result.interpretation : cell.interpretation,
            answer: result.ok ? result.answer : null,
            suggestions: result.ok ? result.suggestions : [],
            // The record follows the code: a generation writes a new one, even a failed one, since its code is kept.
            // A plain run leaves it alone, so rerunning saved code keeps how the code was made
            provenance: result.provenance ?? null,
          }
        : {}),
    }
    // History keeps the version that actually ran, not the edits made meanwhile
    if (result.ok && !nothingRan) ran.history = remember(ran)
    const updated: PromptCell = nothingRan
      ? cell
      : promptEdited || codeEdited
        ? {
            ...ran,
            prompt: cell.prompt,
            code: codeEdited ? cell.code : ran.code,
            codeEdited: codeEdited || ran.codeEdited,
            state: 'edited',
          }
        : ran

    const nextCells = cells.map((c, i) => {
      if (i === index) return updated
      // Rerunning a cell makes later outputs suspect, as in Jupyter
      if (result.ok && i > index && c.kind === 'prompt' && c.state === 'done') return { ...c, state: 'stale' as const }
      return c
    })
    return {
      notebook: { ...s.notebook, cells: nextCells },
      lastFinishedId: result.ok ? id : s.lastFinishedId,
      dirty: s.dirty || !nothingRan,
      runs,
      activity: generate && result.activity.length ? { ...s.activity, [id]: result.activity } : s.activity,
      messages: result.error && !(stopped && !nothingRan) ? { ...s.messages, [id]: result.error } : s.messages,
    }
  })
}

/** Cells Verify has queued, with the code each reruns. A cell leaves when its rerun ends or can't happen. */
const verifyRuns = new Map<string, string>()
/** Bumped by each Verify and by load(), so a Verify that waits on a restart knows when it's been overtaken. */
let verifyEpoch = 0

const isVerifying = () => {
  const phase = get().verify?.phase
  return phase === 'restarting' || phase === 'running' || phase === 'stopping'
}

function setVerify(fn: (report: VerifyReport) => VerifyReport) {
  set((s) => (s.verify ? { verify: fn(s.verify) } : {}))
}

function setVerifyCell(id: string, patch: Partial<VerifyCell>) {
  setVerify((r) => ({ ...r, cells: r.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
}

/**
 * Runs once the user confirms Verify, before Python restarts. This is the place for checks that compare the
 * notebook with the machine it runs on now, such as the Python, its libraries and the data files the cells read.
 * There are none yet. A check must not hold Verify up for long: it can show a notice or a banner, and Verify
 * goes ahead even if it throws.
 */
async function beforeVerify(): Promise<void> {}

/** Restart Python and mark the cells that ran out of date. Resolves with why it failed, or null. */
async function restartPython(): Promise<string | null> {
  try {
    await api?.restartKernel()
  } catch (err) {
    actions.notifyFailure("Couldn't restart Python", err)
    return errorText(err)
  }
  addLog({ kind: 'restarted', text: 'Restarted Python' })
  // Outputs stay, but the variables they came from are gone
  updateCells((cells) => cells.map((c) => (c.kind === 'prompt' && hasRun(c) ? { ...c, executionCount: null, state: 'stale' as const } : c)))
  set({ variables: [] })
  actions.environmentChanged()
  return null
}

/** Stop pressed during Verify: cells still waiting won't run. The running one reports when its run stops. */
function stopVerify() {
  const report = get().verify
  if (!report || !isVerifying()) return
  const running = new Set([...verifyRuns.keys()].filter((id) => get().runs[id]?.status === 'running'))
  for (const id of [...verifyRuns.keys()]) if (!running.has(id)) verifyRuns.delete(id)
  set({
    verify: {
      ...report,
      phase: running.size ? 'stopping' : 'stopped',
      cells: report.cells.map((c) => (c.status === 'waiting' && !running.has(c.id) ? { ...c, status: 'not-run' } : c)),
    },
  })
  if (!running.size) logVerify()
}

/** Once no rerun is left, the report is done, or stopped if Stop was pressed. */
function settleVerify() {
  const phase = get().verify?.phase
  if (verifyRuns.size || (phase !== 'running' && phase !== 'stopping')) return
  setVerify((r) => ({ ...r, phase: phase === 'running' ? 'done' : 'stopped' }))
  logVerify()
}

function logVerify() {
  const report = get().verify
  if (report) addLog({ kind: 'verified', text: verifySummary(report) })
}

/** The report in a sentence: "Verified 5 cells: 3 the same, 1 changed, 1 failed." */
export function verifySummary(report: VerifyReport): string {
  const count = (status: VerifyStatus) => report.cells.filter((c) => c.status === status).length
  const ran = report.cells.filter((c) => c.status !== 'no-code' && c.status !== 'not-run' && c.status !== 'waiting').length
  const parts = [
    count('same') && `${count('same')} the same`,
    count('figure') && `${count('figure')} with a figure that differs`,
    count('changed') && `${count('changed')} changed`,
    count('failed') && `${count('failed')} failed`,
    count('stopped') && `${count('stopped')} stopped`,
  ].filter(Boolean)
  const detail = parts.length ? `: ${parts.join(', ')}` : ''
  if (report.phase === 'stopped' || report.phase === 'stopping') {
    const planned = report.cells.filter((c) => c.status !== 'no-code').length
    return `Stopped verifying after ${ran} of ${planned} ${planned === 1 ? 'cell' : 'cells'}${detail}.`
  }
  return `Verified ${ran} ${ran === 1 ? 'cell' : 'cells'}${detail}.`
}

/**
 * A Verify rerun ended. It goes into the report and never into the cell's outputs. A cell whose outputs came
 * back the same is marked up to date again, since what it shows is what the kernel now holds.
 */
function finishVerify(id: string, result: CellRunResult) {
  verifyRuns.delete(id)
  set((s) => ({ runs: omit(s.runs, id) }))
  const report = get().verify
  const entry = report?.cells.find((c) => c.id === id)
  // Deleted while it ran, or its notebook was closed
  if (abandoned.delete(id) || !report || !entry) {
    if (entry) setVerifyCell(id, { status: 'not-run' })
    settleVerify()
    return
  }
  const interrupted = result.error === 'Stopped.' || (report.phase === 'stopping' && !result.ok)
  const status: VerifyStatus = interrupted ? 'stopped' : !result.ok ? 'failed' : compareOutputs(entry.saved, result.outputs)
  const name = status === 'failed' ? missingName(result.outputs) : null
  const patch: Partial<VerifyCell> = {
    status,
    fresh: result.outputs,
    executionCount: result.executionCount,
    durationMs: result.durationMs,
    variables: result.variables,
    error: result.error,
  }
  if (name) {
    const index = report.cells.indexOf(entry)
    const cells = report.cells.map((c, i) => ({
      number: c.number,
      code: c.code,
      failed: i === index || c.status === 'failed',
      assigned: c.variables.map((v) => v.name),
      agentCode: agentCode(c.id),
    }))
    const cause = missingNameCause(name, index, cells)
    patch.missing = cause && { name, cause }
  }
  setVerifyCell(id, patch)
  if (status === 'same') {
    set((s) => ({
      notebook: {
        ...s.notebook,
        cells: s.notebook.cells.map((c) =>
          c.id === id && c.kind === 'prompt' && c.outputs === entry.saved && c.code === entry.code
            ? // Kept outputs from Jupyter are written back only while the count they were saved with stands
              { ...c, state: 'done' as const, executionCount: c.jupyter?.outputs ? c.executionCount : result.executionCount }
            : c,
        ),
      },
    }))
  }
  settleVerify()
}

/**
 * Code the agent ran while making a cell that isn't the cell's own: explore calls and earlier attempts, from
 * this session's activity and from the record of how the cell was made.
 */
function agentCode(id: string): string[] {
  const cell = findCell(id)
  const own = cell?.kind === 'prompt' ? cell.code : ''
  const steps = (get().activity[id] ?? []).flatMap((a) => (a.code ? [a.code] : []))
  const attempts = cell?.kind === 'prompt' ? (cell.provenance?.attempts ?? []).map((a) => a.code) : []
  return [...steps, ...attempts].filter((code) => code !== own)
}

/** Add the cell's current version to its history, unless it is the one already on top. */
function remember(cell: PromptCell) {
  const top = cell.history[0]
  if (top && top.code === cell.code && top.prompt === cell.prompt) return cell.history
  const rev = { at: Date.now(), prompt: cell.prompt, code: cell.code, interpretation: cell.interpretation, answer: cell.answer, edited: cell.codeEdited }
  return [rev, ...cell.history].slice(0, MAX_REVISIONS)
}

function logRun(cell: Cell | undefined, generate: boolean, result: CellRunResult): number | null {
  if (!cell) return null
  const name = quoted(cell)
  const cost = costView(result.cost)
  if (result.error === 'Stopped.') return addLog({ kind: 'stopped', text: `Stopped ${name}`, cellId: cell.id, cost })
  if (!result.ok) {
    const err = result.outputs.find((o) => o.type === 'error')
    const clipped = (t: string) => (t.length > 140 ? `${t.slice(0, 139)}…` : t)
    const why = err?.type === 'error' ? clipped(`${err.ename}${err.evalue ? `: ${err.evalue}` : ''}`) : result.error ? clipped(result.error) : 'error'
    return addLog({ kind: 'failed', text: `${name} failed: ${why}`, cellId: cell.id, cost })
  }
  return addLog({ kind: generate ? 'wrote' : 'ran', text: `${generate ? 'Wrote' : 'Ran'} ${name}`, cellId: cell.id, cost })
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
