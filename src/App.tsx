import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsDialog } from '@/components/app/SettingsDialog'
import { Sidebar } from '@/components/app/Sidebar'
import { TopBar } from '@/components/app/TopBar'
import { NotebookView } from '@/components/notebook/NotebookView'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { MenuAction } from '@/shared/ipc'
import type { Cell } from '@/shared/notebook'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'

type Undo = { cell: Cell; index: number }

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const settings = useNotebook((s) => s.settings)
  const python = useNotebook((s) => s.python)
  const kernel = useNotebook((s) => s.kernel)
  const path = useNotebook((s) => s.path)
  const dirty = useNotebook((s) => s.dirty)
  const api = getApi()

  const deleteCell = useCallback((id: string) => {
    const removed = actions.deleteCell(id)
    if (!removed) return
    setUndo(removed)
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])

  const save = useCallback(
    async (as: boolean) => {
      if (!api) return
      const { path, notebook } = useNotebook.getState()
      const saved = await api.saveNotebook(as ? null : path, notebook)
      if (saved) actions.markSaved(saved)
    },
    [api],
  )

  const handleMenu = useCallback(
    async (action: MenuAction) => {
      if (!api) return
      const selected = useNotebook.getState().selectedId
      switch (action) {
        case 'new':
          if (await api.confirmDiscard()) {
            actions.load(welcomeNotebook(), null)
            await api.restartKernel()
          }
          break
        case 'open':
          if (await api.confirmDiscard()) {
            const opened = await api.openNotebook()
            if (opened) actions.load(opened.notebook, opened.path)
          }
          break
        case 'save':
          return save(false)
        case 'save-as':
          return save(true)
        case 'run-cell':
          if (selected) actions.runAndAdvance(selected)
          break
        case 'run-all':
          actions.runAll()
          break
        case 'interrupt':
          return actions.interrupt()
        case 'restart':
          return actions.restart()
        case 'settings':
          setSettingsOpen(true)
          break
        case 'add-prompt':
          actions.insertAfterSelected('prompt')
          break
        case 'add-note':
          actions.insertAfterSelected('note')
          break
      }
    },
    [api, save],
  )

  // Connect the store to the Electron bridge
  useEffect(() => {
    if (!api) return
    void api.getSettings().then((settings) => useNotebook.setState({ settings }))
    void api.pythonState().then((python) => useNotebook.setState({ python }))
    void api.kernelState().then((kernel) => useNotebook.setState({ kernel }))
    const offs = [
      api.onRunEvent((cellId, event) => actions.applyRunEvent(cellId, event)),
      api.onKernelState((kernel) => useNotebook.setState({ kernel })),
      api.onMenu((action) => void handleMenu(action)),
    ]
    return () => offs.forEach((off) => off())
  }, [api, handleMenu])

  useEffect(() => {
    api?.setDocumentState({ path, dirty })
  }, [api, path, dirty])

  useCommandMode(deleteCell)

  const needsKey = settings != null && settings.keySource == null
  const needsPython = python != null && (!python.python || python.missingPackages.length > 0)

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col">
        <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} onOpenSettings={() => setSettingsOpen(true)} />
        {(needsKey || needsPython || kernel.error) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-raised px-4 py-2 text-[13px]">
            <span className="text-muted-foreground">
              {needsKey
                ? 'Add an API key to turn prompts into code.'
                : !python?.python
                  ? 'Python is not set up yet.'
                  : needsPython
                    ? `Python is missing ${python!.missingPackages.join(', ')}. Cells that need them will fail.`
                    : kernel.error}
            </span>
            <Button size="xs" variant="secondary" onClick={() => setSettingsOpen(true)}>
              Open Settings
            </Button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && <Sidebar />}
          <NotebookView onDelete={deleteCell} />
        </div>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {undo && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-[#2a2a2a] px-3.5 py-2 text-[13px] shadow-xl" role="status">
          Cell deleted
          <button
            type="button"
            className="font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              actions.restoreCell(undo.cell, undo.index)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </TooltipProvider>
  )
}

/**
 * Jupyter's command mode: when no editor has focus, single keys act on the selected cell.
 * A/B insert above/below, M/Y switch to note/prompt, T folds tables, D D deletes, arrows or J/K move, Enter edits.
 */
function useCommandMode(deleteCell: (id: string) => void) {
  useEffect(() => {
    let lastD = 0
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('textarea, input, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return
      if (target.closest('button, a, summary, [role="tab"]') && (e.key === 'Enter' || e.key === ' ')) return
      const { selectedId, notebook } = useNotebook.getState()
      if (!selectedId) return
      const index = notebook.cells.findIndex((c) => c.id === selectedId)
      if (index < 0) return
      const key = e.key
      if (key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        actions.runAndAdvance(selectedId)
      } else if (key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        actions.run(selectedId)
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return
      } else if (key === 'Enter') {
        e.preventDefault()
        actions.focus(selectedId)
      } else if (key === 'a') actions.insertCell(index, 'prompt')
      else if (key === 'b') actions.insertCell(index + 1, 'prompt')
      else if (key === 't') actions.toggleTables(selectedId)
      else if (key === 'm') actions.setKind(selectedId, 'note')
      else if (key === 'y') actions.setKind(selectedId, 'prompt')
      else if (key === 'ArrowUp' || key === 'k') {
        e.preventDefault()
        if (index > 0) actions.select(notebook.cells[index - 1].id)
      } else if (key === 'ArrowDown' || key === 'j') {
        e.preventDefault()
        if (index < notebook.cells.length - 1) actions.select(notebook.cells[index + 1].id)
      } else if (key === 'd') {
        if (Date.now() - lastD < 500) {
          deleteCell(selectedId)
          lastD = 0
        } else lastD = Date.now()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteCell])
}
