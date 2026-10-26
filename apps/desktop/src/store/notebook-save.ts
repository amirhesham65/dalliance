import type { DallianceApi, RenameResult } from '@dalliance/shared/ipc'
import { actions, getApi, useNotebook } from './notebook-store'

// Saves and renames share a queue so a slow save cannot recreate a file under its old name.
let writes: Promise<unknown> = Promise.resolve()

function writeDocument<T>(write: (api: DallianceApi) => Promise<T>): Promise<T | null> {
  const api = getApi()
  const { documentId } = useNotebook.getState()
  const next = writes.then(() => {
    if (!api || api !== getApi() || documentId !== useNotebook.getState().documentId) return null
    return write(api)
  })
  writes = next.catch(() => {})
  return next
}

export async function saveNotebook(as = false, autoSave = false): Promise<void> {
  const requestedPath = useNotebook.getState().path
  await writeDocument(async (api) => {
    const { notebook, path, dirty, documentId } = useNotebook.getState()
    // Background saves never open a dialog, or follow a queued rename to a different file.
    if (autoSave && (!path || !dirty || path !== requestedPath)) return
    try {
      const saved = await api.saveNotebook(as ? null : path, notebook, { autoSave })
      const current = useNotebook.getState()
      if (current.documentId !== documentId || current.path !== path) return
      if (saved) actions.markSaved(saved.path, saved.pins, notebook)
    } catch (err) {
      if (useNotebook.getState().documentId === documentId) {
        actions.notifyFailure(autoSave ? "Couldn't auto-save the notebook" : "Couldn't save the notebook", err)
      }
    }
  })
}

export function renameNotebook(name: string): Promise<RenameResult | null> {
  return writeDocument(async (api) => {
    const { path, notebook, documentId } = useNotebook.getState()
    const result = await api.renameNotebook(path, name, notebook)
    const current = useNotebook.getState()
    if (current.documentId !== documentId || current.path !== path) return null
    if (!('error' in result)) actions.renamed(result.path, result.saved, result.pins, notebook)
    return result
  })
}

/** Watch document edits rather than renders, so live run activity never postpones a save. */
export function startAutoSave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    const { path, dirty } = useNotebook.getState()
    if (path && dirty) timer = setTimeout(() => void saveNotebook(false, true), 1000)
  }
  const off = useNotebook.subscribe((s, prev) => {
    if (s.notebook !== prev.notebook || s.path !== prev.path || s.dirty !== prev.dirty || s.documentId !== prev.documentId) schedule()
  })
  schedule()
  return () => {
    off()
    clearTimeout(timer)
  }
}
