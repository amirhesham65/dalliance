import { create } from 'zustand'
import { cellTitle } from '@/lib/notebook/text'
import type {
  ActivityItem,
  Brief,
  CellRunResult,
  KernelState,
  DallianceApi,
  ModelList,
  PaneName,
  PythonState,
  RunCellRequest,
  RunEvent,
  SettingsView,
  VariableView,
} from '@dalliance/shared/ipc'
import {
  type Cell,
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
  kind: 'wrote' | 'ran' | 'failed' | 'stopped' | 'restarted' | 'restored'
  text: string
  cellId?: string
}

/** The side panes, one open at a time. Cmd+1 to Cmd+6 open them in this order. */
export type PaneKind = PaneName
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
  settings: SettingsView | null
  /** The Settings section on screen, or null when Settings is closed. It covers whatever screen is under it. */
  settingsPage: SettingsSection | null
  python: PythonState | null
  /** A cell whose editor should take keyboard focus on its next render. */
  focusId: string | null
  /** What happened in this session, newest first. */
  log: LogEntry[]
  /** The cell that most recently finished running, which shows its suggested next prompts. */
  lastFinishedId: string | null
  pane: PaneKind | null
  /** Cells whose results are pinned in the side pane, in the order they were pinned. */
  pinnedIds: string[]
  brief: Brief | null
  /** What the model picker offers. Loaded when the picker first opens. */
  models: ModelList | null
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
export const SETTINGS_SECTIONS = ['models', 'agent', 'python'] as const
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
  settings: null,
  settingsPage: null,
  python: null,
  focusId: null,
  log: [],
  lastFinishedId: null,
  pane: null,
  pinnedIds: [],
  brief: null,
  models: null,
}))

const MAX_LOG = 60
let logId = 0

function addLog(entry: Omit<LogEntry, 'id' | 'at'>) {
  set((s) => ({ log: [{ ...entry, id: ++logId, at: Date.now() }, ...s.log].slice(0, MAX_LOG) }))
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

export const actions = {
  load(notebook: Notebook, path: string | null, dirty = false) {
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
      lastFinishedId: null,
      pinnedIds: [],
      pane: get().pane === 'pinned' ? null : get().pane,
    })
    queue.length = 0
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

  async loadModels(force = false) {
    const { models, settings } = get()
    if (!api || (!force && models && models.provider === settings?.provider && !models.error)) return
    set({ models: await api.listModels().catch((err: unknown) => ({ provider: settings?.provider ?? 'gateway', models: [], error: String(err) })) })
  },

  async loadBrief() {
    if (!api) return
    set({ brief: await api.readBrief().catch(() => null) })
  },

  async saveBrief(text: string) {
    if (!api) return
    set({ brief: await api.writeBrief(text) })
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
    updateCells((cs) => [...cs.slice(0, index + 1), cell, ...cs.slice(index + 1)])
    set({ selectedId: cell.id })
    actions.run(cell.id)
  },

  /** Bring back an earlier version of a cell. It runs its saved code on the next run, without the agent. */
  restoreRevision(id: string, at: number) {
    const cell = get().notebook.cells.find((c) => c.id === id)
    if (!cell || cell.kind !== 'prompt') return
    const rev = cell.history.find((r) => r.at === at)
    if (!rev) return
    updateCell(id, (c) =>
      c.kind !== 'prompt'
        ? c
        : {
            ...c,
            prompt: rev.prompt,
            code: rev.code,
            generatedFrom: rev.prompt,
            codeEdited: rev.edited,
            interpretation: rev.interpretation,
            answer: rev.answer,
            corrections: [],
            state: hasRun(c) ? 'edited' : c.state,
          },
    )
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
    if (!to.trim() || from === to) return
    updateCell(id, (c) =>
      c.kind !== 'prompt'
        ? c
        : {
            ...c,
            interpretation: c.interpretation?.replace(`[[${from}]]`, `[[${to}]]`) ?? null,
            corrections: [...c.corrections.filter((x) => x.to !== from), { from, to }],
            state: 'edited',
          },
    )
  },

  insertCell(index: number, kind: 'prompt' | 'note'): string {
    const cell = kind === 'prompt' ? newPromptCell() : newNoteCell()
    updateCells((cells) => [...cells.slice(0, index), cell, ...cells.slice(index)])
    set({ selectedId: cell.id, focusId: cell.id })
    return cell.id
  },

  insertAfterSelected(kind: 'prompt' | 'note'): string {
    const { notebook, selectedId } = get()
    const index = notebook.cells.findIndex((c) => c.id === selectedId)
    return actions.insertCell(index < 0 ? notebook.cells.length : index + 1, kind)
  },

  deleteCell(id: string): { cell: Cell; index: number } | null {
    const cells = get().notebook.cells
    const index = cells.findIndex((c) => c.id === id)
    if (index < 0) return null
    const cell = cells[index]
    if (get().runs[id]?.status === 'running') void api?.interrupt()
    removeFromQueue(id)
    updateCells((cs) => cs.filter((c) => c.id !== id))
    const rest = get().notebook.cells
    set({ selectedId: rest[Math.min(index, rest.length - 1)]?.id ?? null })
    return { cell, index }
  },

  restoreCell(cell: Cell, index: number) {
    updateCells((cells) => [...cells.slice(0, index), cell, ...cells.slice(index)])
    set({ selectedId: cell.id })
  },

  moveCell(id: string, delta: -1 | 1) {
    const cells = [...get().notebook.cells]
    const i = cells.findIndex((c) => c.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= cells.length) return
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
    updateCells(() => cells)
  },

  setKind(id: string, kind: 'prompt' | 'note') {
    updateCell(id, (c) => {
      if (c.kind === kind) return c
      if (kind === 'note') return { ...newNoteCell(c.kind === 'prompt' ? c.prompt : ''), id: c.id }
      return { ...newPromptCell(c.kind === 'note' ? c.markdown : ''), id: c.id }
    })
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
    set((s) => ({ runs: Object.fromEntries(Object.entries(s.runs).filter(([, r]) => r.status === 'running')) }))
    await api?.interrupt()
  },

  async restart() {
    await actions.interrupt()
    await api?.restartKernel()
    addLog({ kind: 'restarted', text: 'Restarted Python' })
    // Outputs stay, but the variables they came from are gone
    updateCells((cells) =>
      cells.map((c) => (c.kind === 'prompt' && hasRun(c) ? { ...c, executionCount: null, state: 'stale' as const } : c)),
    )
    set({ variables: [] })
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
      updateCell(id, (c) => (c.kind === 'prompt' ? { ...c, title: event.title, titleFrom: event.prompt } : c))
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
}

function emptyRun(status: CellRun['status']): CellRun {
  return { status, statusText: status === 'queued' ? 'Waiting' : 'Starting', activity: [], liveOutputs: [], liveCode: null, question: null, approval: null, startedAt: Date.now() }
}

const queue: string[] = []
let pumping = false

function removeFromQueue(id: string) {
  const i = queue.indexOf(id)
  if (i >= 0) queue.splice(i, 1)
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
      const generate = needsGeneration(cell)
      set((s) => ({
        runs: { ...s.runs, [id]: { ...emptyRun('running'), statusText: generate ? 'Writing code' : 'Running' } },
        messages: omit(s.messages, id),
      }))
      const request: RunCellRequest = {
        cellId: id,
        prompt: cell.prompt,
        code: cell.code,
        generate,
        // Any run names a cell that has no title for its current prompt, including reruns of saved code
        nameIt: cell.prompt.trim().length >= MIN_TITLE_PROMPT && cell.titleFrom?.trim() !== cell.prompt.trim(),
        corrections: cell.corrections,
        previousCells: cells.slice(0, index).map((c) =>
          c.kind === 'note' ? { kind: 'note' as const, text: c.markdown } : { kind: 'prompt' as const, text: c.prompt, code: c.code },
        ),
      }
      const result: CellRunResult = api
        ? await api.runCell(request).catch((err: unknown) => failed(request, err))
        : failed(request, 'Running cells needs the desktop app.')
      finish(id, generate, result)
    }
  } finally {
    pumping = false
  }
  void actions.refreshVariables().catch(() => {})
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
    error: err instanceof Error ? err.message : String(err),
  }
}

function finish(id: string, generate: boolean, result: CellRunResult) {
  const stopped = result.error === 'Stopped.'
  logRun(get().notebook.cells.find((c) => c.id === id), generate, result)
  set((s) => {
    const cells = s.notebook.cells
    const index = cells.findIndex((c) => c.id === id)
    const cell = cells[index]
    const runs = omit(s.runs, id)
    if (!cell || cell.kind !== 'prompt') return { runs }

    // Nothing ran at all (no key, no Python, stopped before code ran): keep the cell as it was
    const nothingRan = result.executionCount == null && result.outputs.length === 0 && !result.ok
    const updated: PromptCell = nothingRan
      ? cell
      : {
          ...cell,
          code: result.code,
          outputs: result.outputs,
          variables: result.ok ? result.variables : cell.variables,
          executionCount: result.executionCount,
          durationMs: result.durationMs,
          state: result.ok ? 'done' : 'error',
          ...(generate
            ? {
                // A failed generation leaves generatedFrom empty, so the next run tries again
                generatedFrom: result.ok ? cell.prompt : '',
                codeEdited: false,
                corrections: result.ok ? [] : cell.corrections,
                interpretation: result.ok ? result.interpretation : cell.interpretation,
                answer: result.ok ? result.answer : null,
                suggestions: result.ok ? result.suggestions : [],
              }
            : {}),
        }
    if (result.ok && !nothingRan) updated.history = remember(updated)

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

/** Add the cell's current version to its history, unless it is the one already on top. */
function remember(cell: PromptCell) {
  const top = cell.history[0]
  if (top && top.code === cell.code && top.prompt === cell.prompt) return cell.history
  const rev = { at: Date.now(), prompt: cell.prompt, code: cell.code, interpretation: cell.interpretation, answer: cell.answer, edited: cell.codeEdited }
  return [rev, ...cell.history].slice(0, MAX_REVISIONS)
}

function logRun(cell: Cell | undefined, generate: boolean, result: CellRunResult) {
  if (!cell) return
  const name = quoted(cell)
  if (result.error === 'Stopped.') return addLog({ kind: 'stopped', text: `Stopped ${name}`, cellId: cell.id })
  if (!result.ok) {
    const err = result.outputs.find((o) => o.type === 'error')
    const clipped = (t: string) => (t.length > 140 ? `${t.slice(0, 139)}…` : t)
    const why = err?.type === 'error' ? clipped(`${err.ename}${err.evalue ? `: ${err.evalue}` : ''}`) : result.error ? clipped(result.error) : 'error'
    return addLog({ kind: 'failed', text: `${name} failed: ${why}`, cellId: cell.id })
  }
  addLog({ kind: generate ? 'wrote' : 'ran', text: `${generate ? 'Wrote' : 'Ran'} ${name}`, cellId: cell.id })
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
