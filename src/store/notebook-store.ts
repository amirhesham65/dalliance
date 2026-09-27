import { create } from 'zustand'
import type {
  ActivityItem,
  CellRunResult,
  KernelState,
  IliosApi,
  PythonState,
  RunCellRequest,
  RunEvent,
  SettingsView,
  VariableView,
} from '@/shared/ipc'
import {
  type Cell,
  type Notebook,
  type Output,
  type PromptCell,
  needsGeneration,
  newNoteCell,
  tablesOpen,
  newPromptCell,
} from '@/shared/notebook'

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

export interface NotebookState {
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
  python: PythonState | null
  /** A cell whose editor should take keyboard focus on its next render. */
  focusId: string | null
}

let api: IliosApi | undefined = typeof window === 'undefined' ? undefined : window.ilios

/** Tests and the browser preview swap in a fake bridge. */
export function setApi(next: IliosApi | undefined) {
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

export const useNotebook = create<NotebookState>(() => ({
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
  python: null,
  focusId: null,
}))

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
  load(notebook: Notebook, path: string | null) {
    set({
      notebook,
      path,
      dirty: false,
      selectedId: notebook.cells[0]?.id ?? null,
      runs: {},
      activity: {},
      messages: {},
      variables: [],
    })
    queue.length = 0
  },

  markSaved(path: string) {
    set({ path, dirty: false })
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
    variables: [],
    activity: [],
    error: err instanceof Error ? err.message : String(err),
  }
}

function finish(id: string, generate: boolean, result: CellRunResult) {
  const stopped = result.error === 'Stopped.'
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
              }
            : {}),
        }

    const nextCells = cells.map((c, i) => {
      if (i === index) return updated
      // Rerunning a cell makes later outputs suspect, as in Jupyter
      if (result.ok && i > index && c.kind === 'prompt' && c.state === 'done') return { ...c, state: 'stale' as const }
      return c
    })
    return {
      notebook: { ...s.notebook, cells: nextCells },
      dirty: s.dirty || !nothingRan,
      runs,
      activity: generate && result.activity.length ? { ...s.activity, [id]: result.activity } : s.activity,
      messages: result.error && !(stopped && !nothingRan) ? { ...s.messages, [id]: result.error } : s.messages,
    }
  })
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
