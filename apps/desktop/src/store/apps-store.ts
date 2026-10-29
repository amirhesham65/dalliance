import { create } from 'zustand'
import type { AppView } from '@dalliance/shared/apps'
import { actions, getApi, useNotebook } from './notebook-store'

interface AppsState {
  workspace: string
  apps: AppView[]
  selectedId: string | null
  showing: boolean
  loading: boolean
  error: string | null
  busy: Record<string, boolean>
}
export const useApps = create<AppsState>(() => ({ workspace: '', apps: [], selectedId: null, showing: false, loading: false, error: null, busy: {} }))
let epoch = 0
let refreshRequest = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const appActions = {
  workspace(workspace: string) {
    if (workspace === useApps.getState().workspace) return
    epoch++
    useApps.setState({ workspace, apps: [], selectedId: null, showing: false, error: null, busy: {} })
    void appActions.refresh()
  },

  async refresh() {
    const api = getApi()
    if (!api) return
    const current = epoch
    const request = ++refreshRequest
    useApps.setState({ loading: true })
    try {
      const apps = await api.listApps()
      if (current !== epoch || request !== refreshRequest) return
      useApps.setState({ apps, error: null, loading: false })
    } catch (err) {
      if (current === epoch && request === refreshRequest) useApps.setState({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  scheduleRefresh() {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => { refreshTimer = null; void appActions.refresh() }, 150)
  },

  async open(id: string) {
    useApps.setState({ selectedId: id, showing: true })
    actions.openPane('apps')
    await appActions.refresh()
    const app = useApps.getState().apps.find((a) => a.id === id)
    if (app && app.status === 'stopped') await appActions.start(id)
  },

  notebook() { useApps.setState({ showing: false }) },

  async start(id: string) {
    return operate(id, async () => { await getApi()?.startApp(id) })
  },

  async stop(id: string) {
    // Stop remains available while a start is pending.
    await getApi()?.stopApp(id).catch((err: unknown) => actions.notifyFailure("Couldn't stop the app", err))
    await appActions.refresh()
  },

  async restart(id: string) {
    return operate(id, async () => {
      await getApi()?.stopApp(id)
      await getApi()?.startApp(id)
    })
  },

  async keepRunning(id: string, keep: boolean) {
    return operate(id, async () => { await getApi()?.keepAppRunning(id, keep) })
  },
  async refreshData(id: string) {
    return operate(id, async () => { await getApi()?.refreshAppData(id) })
  },
  async remove(id: string) {
    return operate(id, async () => {
      if (await getApi()?.deleteApp(id)) {
        if (useApps.getState().selectedId === id) useApps.setState({ showing: false, selectedId: null })
      }
    })
  },
  async clearHistory(id: string) {
    return operate(id, async () => { await getApi()?.clearAppHistory(id) })
  },

  async restore(id: string) {
    return operate(id, async () => { await getApi()?.restoreApp(id) })
  },

  source(app: AppView) {
    appActions.notebook()
    actions.select(app.sourceCellId)
    actions.focus(app.sourceCellId)
  },

  fix(app: AppView) {
    appActions.notebook()
    const cells = useNotebook.getState().notebook.cells
    actions.insertCell(cells.length, 'prompt')
    const id = useNotebook.getState().selectedId
    if (id) {
      actions.setPrompt(id, `Fix the app "${app.title}" (id: ${app.id}).${app.error ? `\nIt failed with: ${app.error.slice(0, 2000)}` : '\nDescribe the change you want here.'}`)
      actions.focus(id)
    }
  },
}

async function operate(id: string, operation: () => Promise<void>) {
  if (useApps.getState().busy[id]) return
  const current = epoch
  useApps.setState((s) => ({ busy: { ...s.busy, [id]: true } }))
  try { await operation() } catch (err) {
    if (current === epoch) actions.notifyFailure('App operation failed', err)
  } finally {
    if (current === epoch) {
      useApps.setState((s) => ({ busy: { ...s.busy, [id]: false } }))
      await appActions.refresh()
    }
  }
}
