import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from '@/components/app/Sidebar'
import { TopBar } from '@/components/app/TopBar'
import { NotebookView } from '@/components/notebook/NotebookView'
import { SidePane } from '@/components/panes/SidePanes'
import { SettingsScreen } from '@/components/settings/SettingsScreen'
import { WelcomeScreen } from '@/components/welcome/Welcome'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDefaultLayout } from 'react-resizable-panels'
import type { MenuAction } from '@dalliance/shared/ipc'
import type { Cell } from '@dalliance/shared/notebook'
import { PANE_ORDER, actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'

type Undo = { cell: Cell; index: number }

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => readStored('dalliance-sidebar') !== 'closed')
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const settings = useNotebook((s) => s.settings)
  const python = useNotebook((s) => s.python)
  const kernel = useNotebook((s) => s.kernel)
  const path = useNotebook((s) => s.path)
  const dirty = useNotebook((s) => s.dirty)
  const screen = useNotebook((s) => s.screen)
  const settingsPage = useNotebook((s) => s.settingsPage)
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
          actions.openSettings()
          break
        case 'add-prompt':
          actions.insertAfterSelected('prompt')
          break
        case 'add-note':
          actions.insertAfterSelected('note')
          break
        case 'toggle-sidebar':
          setSidebarOpen((o) => !o)
          break
        case 'welcome':
          if (useNotebook.getState().screen === 'notebook') actions.showWelcome(true)
          break
        default:
          if (action.startsWith('pane-')) {
            setSidebarOpen(true)
            actions.openPane(action.slice(5) as (typeof PANE_ORDER)[number])
          }
      }
    },
    [api, save],
  )

  // Connect the store to the Electron bridge
  useEffect(() => {
    if (!api) return
    void api.getSettings().then((settings) => useNotebook.setState({ settings }))
    void api.getAccount().then((account) => useNotebook.setState({ account }))
    void api.pythonState().then((python) => useNotebook.setState({ python }))
    void api.kernelState().then((kernel) => useNotebook.setState({ kernel }))
    void actions.loadBrief()
    const offs = [
      api.onRunEvent((cellId, event) => actions.applyRunEvent(cellId, event)),
      api.onKernelState((kernel) => useNotebook.setState({ kernel })),
      api.onAccount((account) => useNotebook.setState({ account })),
      api.onMenu((action) => void handleMenu(action)),
    ]
    return () => offs.forEach((off) => off())
  }, [api, handleMenu])

  useEffect(() => {
    api?.setDocumentState({ path, dirty })
  }, [api, path, dirty])

  useCommandMode(deleteCell)
  useScopedSelectAll()

  useEffect(() => writeStored('dalliance-sidebar', sidebarOpen ? 'open' : 'closed'), [sidebarOpen])

  // Cmd+1 to Cmd+6 toggle the side panes, opening the overview first if it's hidden
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (useNotebook.getState().screen !== 'notebook' || useNotebook.getState().settingsPage) return
      const pane = PANE_ORDER[Number(e.key) - 1]
      if (!pane) return
      e.preventDefault()
      if (!sidebarOpen) {
        setSidebarOpen(true)
        actions.openPane(pane)
      } else actions.togglePane(pane)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  const needsKey = settings != null && settings.keySource == null
  const needsPython = python != null && (!python.python || python.missingPackages.length > 0)

  return (
    <TooltipProvider delayDuration={400}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="h-full min-h-0 flex-col bg-canvas">
        <TopBar minimal={screen === 'welcome'} />
        {/* Settings covers this area without unmounting it, so the notebook or the setup keeps its state */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div inert={settingsPage != null} className="flex min-h-0 flex-1 flex-col">
            {screen === 'welcome' ? (
              <WelcomeScreen />
            ) : (
              <>
                {(needsKey || needsPython || kernel.error) && (
                  <div className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-background px-4 py-2 text-[13px] shadow-pane">
                    <span className="text-muted-foreground">
                      {needsKey
                        ? 'Add an API key to turn prompts into code.'
                        : !python?.python
                          ? 'Python is not set up yet.'
                          : needsPython
                            ? `Python is missing ${python!.missingPackages.join(', ')}. Cells that need them will fail.`
                            : kernel.error}
                    </span>
                    <Button size="xs" variant="secondary" onClick={() => actions.openSettings(needsKey ? 'models' : 'python')}>
                      Open Settings
                    </Button>
                  </div>
                )}
                <Workspace onDelete={deleteCell} />
              </>
            )}
          </div>
          {settingsPage && <SettingsScreen />}
        </div>
      </SidebarProvider>
      {undo && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-[13px] text-background shadow-xl" role="status">
          Cell deleted
          <button
            type="button"
            className="font-medium text-background/70 hover:text-background"
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

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; the layout just won't be remembered
  }
}

const layoutStorage = { getItem: readStored, setItem: writeStored }

/**
 * The overview, the open side pane and the notebook, left to right, with draggable gaps between them.
 * The overview sits in its own group, so opening or closing a side pane never changes its width.
 * Cmd+B hides the overview and the side pane together, leaving the notebook.
 */
function Workspace({ onDelete }: { onDelete: (id: string) => void }) {
  const { open, openMobile, isMobile } = useSidebar()
  const pane = useNotebook((s) => s.pane)
  const visible = isMobile ? openMobile : open
  const outer = useDefaultLayout({ id: 'dalliance-overview', panelIds: visible ? ['overview', 'main'] : ['main'], storage: layoutStorage })
  const inner = useDefaultLayout({ id: 'dalliance-panes', panelIds: visible && pane ? ['side', 'notebook'] : ['notebook'], storage: layoutStorage })
  return (
    <ResizablePanelGroup orientation="horizontal" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged} className="min-h-0 flex-1 px-2 pb-2">
      {visible && (
        <>
          <ResizablePanel id="overview" defaultSize={272} minSize={220} maxSize={420} groupResizeBehavior="preserve-pixel-size" className="flex">
            <Sidebar />
          </ResizablePanel>
          <Gap />
        </>
      )}
      <ResizablePanel id="main" minSize={360} className="flex">
        <ResizablePanelGroup orientation="horizontal" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
          {visible && pane && (
            <>
              <ResizablePanel id="side" defaultSize={380} minSize={280} maxSize={680} groupResizeBehavior="preserve-pixel-size" className="flex">
                <SidePane />
              </ResizablePanel>
              <Gap />
            </>
          )}
          <ResizablePanel id="notebook" minSize={360} className="flex">
            <NotebookView onDelete={onDelete} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/** The canvas between two panes doubles as the drag handle. A hairline shows on hover. */
function Gap() {
  return (
    <ResizableHandle className="w-2 bg-transparent before:absolute before:inset-y-4 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:transition-colors after:w-2 hover:before:bg-ring focus-visible:ring-0 focus-visible:before:bg-ring" />
  )
}

/**
 * Cmd+A behaves like a desktop app, not a web page: text fields select their own text, a selection inside
 * an answer or an output grows to that block, and anywhere else nothing happens.
 */
function useScopedSelectAll() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'a') return
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      const selection = window.getSelection()
      const anchor = selection?.anchorNode
      const block = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('[data-selectable]')
      if (selection && block) selection.selectAllChildren(block)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
      if (useNotebook.getState().screen !== 'notebook' || useNotebook.getState().settingsPage) return
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
