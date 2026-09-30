import type { OpenedNotebook, PythonState } from '@dalliance/shared/ipc'
import type { Notebook } from '@dalliance/shared/notebook'
import { actions, getApi, useNotebook } from '@/store/notebook-store'

export const modKey = () => (getApi()?.platform === 'darwin' || navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+')

export const pythonReady = (p: PythonState | null) => p?.python != null && p.missingPackages.length === 0

/**
 * Opens a notebook from the start page. It lands in this tab only when the tab is an untouched Untitled, and in a
 * new tab otherwise, so the notebook behind the start page is never replaced. True when it opened here.
 */
export async function startWith(fn: () => Promise<OpenedNotebook | null>): Promise<boolean> {
  if (!getApi()) return false
  const opened = await fn()
  if (!opened) return false
  actions.load(opened.notebook, opened.path)
  return true
}

/** A new notebook file in the folder in use, on a fresh kernel, so it has a path before anyone saves it. */
export const fresh = (notebook: Notebook) => async (): Promise<OpenedNotebook | null> => getApi()?.newNotebook(notebook) ?? null

/** The folder the open notebook is in, or the one the kernel works in when there is no file. Last part only. */
export const folderName = (notebookPath: string | null, cwd: string): string => {
  const dir = notebookPath ? notebookPath.replace(/[\\/][^\\/]*$/, '') : cwd
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
}

/** Records that the first-run setup is behind us, finished or skipped. */
export async function finishOnboarding() {
  const api = getApi()
  if (!api) return
  useNotebook.setState({ settings: await api.updateSettings({ onboarded: true }) })
}
