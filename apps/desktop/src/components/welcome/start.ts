import type { OpenedNotebook, PythonState } from '@ilios/shared/ipc'
import type { Notebook } from '@ilios/shared/notebook'
import { actions, getApi, useNotebook } from '@/store/notebook-store'

export const modKey = () => (getApi()?.platform === 'darwin' || navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+')

export const pythonReady = (p: PythonState | null) => p?.python != null && p.missingPackages.length === 0

/** Opens a notebook from the start page, asking first if the one behind it has unsaved changes. */
export async function startWith(fn: () => Promise<OpenedNotebook | null>): Promise<boolean> {
  const api = getApi()
  if (!api || !(await api.confirmDiscard())) return false
  const opened = await fn()
  if (!opened) return false
  actions.load(opened.notebook, opened.path)
  return true
}

/** A notebook that isn't a file yet, on a fresh kernel. */
export const fresh = (notebook: Notebook) => async (): Promise<OpenedNotebook> => {
  await getApi()?.restartKernel()
  return { notebook, path: null }
}

/** Records that the first-run setup is behind us, finished or skipped. */
export async function finishOnboarding() {
  const api = getApi()
  if (!api) return
  useNotebook.setState({ settings: await api.updateSettings({ onboarded: true }) })
}
