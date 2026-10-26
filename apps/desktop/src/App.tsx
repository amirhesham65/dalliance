import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorBoundary } from '@/components/app/ErrorBoundary'
import { IconButton } from '@/components/app/IconButton'
import { NewProjectDialog } from '@/components/app/NewProjectDialog'
import { Sidebar } from '@/components/app/Sidebar'
import { TopBar } from '@/components/app/TopBar'
import { UpdateBanner } from '@/components/app/UpdateBanner'
import { NotebookView } from '@/components/notebook/NotebookView'
import { PinChangesBanner } from '@/components/notebook/PinChangesBanner'
import { SidePane } from '@/components/panes/SidePanes'
import { SettingsScreen } from '@/components/settings/SettingsScreen'
import { WelcomeScreen } from '@/components/welcome/Welcome'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useDefaultLayout } from 'react-resizable-panels'
import type { MenuAction } from '@dalliance/shared/ipc'
import { PANE_ORDER, actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'
import { providerOf } from '@dalliance/shared/models'
import { saveNotebook, startAutoSave } from '@/store/notebook-save'

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => readStored('dalliance-sidebar') !== 'closed')
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null)
  const settings = useNotebook((s) => s.settings)
  const providerKeys = useNotebook((s) => s.providerKeys)
  const python = useNotebook((s) => s.python)
  const kernel = useNotebook((s) => s.kernel)
  const path = useNotebook((s) => s.path)
  const dirty = useNotebook((s) => s.dirty)
  const screen = useNotebook((s) => s.screen)
  const settingsPage = useNotebook((s) => s.settingsPage)
  const api = getApi()

  useEffect(() => startAutoSave(), [api])

  const handleMenu = useCallback(
    async (action: MenuAction) => {
      if (!api) return
      const selected = useNotebook.getState().selectedId
      switch (action) {
        case 'undo':
        case 'redo':
          return editFromMenu(action)
        case 'new':
          if (await api.confirmDiscard()) {
            const created = await api.newNotebook(welcomeNotebook())
            if (created) actions.load(created.notebook, created.path)
          }
          break
        case 'new-project':
          // The dialog asks about unsaved changes once a name is chosen
          actions.askNewProject()
          break
        case 'open-project':
          if (await api.confirmDiscard()) {
            const opened = await api.openProject(welcomeNotebook())
            if (opened) actions.load(opened.notebook, opened.path)
          }
          break
        case 'open':
          if (await api.confirmDiscard()) {
            try {
              const opened = await api.openNotebook()
              if (opened) actions.load(opened.notebook, opened.path)
            } catch (err) {
              actions.notifyFailure("Couldn't open the notebook", err)
            }
          }
          break
        case 'save':
          return saveNotebook(false)
        case 'save-as':
          return saveNotebook(true)
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
        case 'verify':
          // Its confirmation shows over the notebook
          if (useNotebook.getState().screen === 'notebook') actions.askVerify()
          break
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
    [api],
  )

  // Connect the store to the Electron bridge
  useEffect(() => {
    if (!api) return
    void api.getSettings().then((settings) => useNotebook.setState({ settings }))
    void api.pythonState().then((python) => useNotebook.setState({ python }))
    void api.kernelState().then((kernel) => useNotebook.setState({ kernel }))
    void api.getProviderKeys().then((providerKeys) => useNotebook.setState({ providerKeys })).catch(() => actions.notify('Could not read API key status. Open Settings > Models.'))
    // Null only means none found yet, so it never replaces one the event below brought in first
    void api.getUpdate().then((update) => update && useNotebook.setState({ update }))
    void actions.loadBrief()
    const offs = [
      api.onUpdate((update) => useNotebook.setState({ update })),
      api.onRunEvent((cellId, event) => actions.applyRunEvent(cellId, event)),
      api.onKernelState((kernel) => useNotebook.setState({ kernel })),
      api.onMenu((action) => void handleMenu(action)),
    ]
    return () => offs.forEach((off) => off())
  }, [api, handleMenu])

  useEffect(() => {
    api?.setDocumentState({ path, dirty })
  }, [api, path, dirty])

  useCommandMode()
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

  const provider = settings ? providerOf(settings.model) : null
  const needsKey = settings != null && providerKeys != null && (!provider || !providerKeys.configured[provider])
  const needsPython = python != null && (!python.python || python.missingPackages.length > 0)
  const banner = needsKey
    ? 'Add your provider API key in Settings to generate cells.'
    : needsPython
      ? !python?.python
        ? 'Python is not set up yet.'
        : `Python is missing ${python.missingPackages.join(', ')}. Cells that need them will fail.`
      : kernel.error
  // A dismissed notice stays gone until its message changes. Once it shows something else, or nothing, forget the
  // dismissal so the banner shows again if that message comes back. Resetting during render, not in an effect,
  // avoids an extra commit
  if (dismissedBanner != null && banner !== dismissedBanner) setDismissedBanner(null)

  return (
    <TooltipProvider delayDuration={400}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="h-full min-h-0 flex-col bg-canvas">
        <TopBar minimal={screen === 'welcome'} />
        {/* Settings covers this area without unmounting it, so the notebook or the setup keeps its state */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div inert={settingsPage != null} className="flex min-h-0 flex-1 flex-col">
            <UpdateBanner />
            {screen === 'welcome' ? (
              <WelcomeScreen />
            ) : (
              <>
                {banner && banner !== dismissedBanner && (
                  <div className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-background py-2 pr-2 pl-4 text-[13px] shadow-pane">
                    <span className="text-muted-foreground">{banner}</span>
                    <Button size="xs" variant="secondary" onClick={() => actions.openSettings(needsKey ? 'models' : 'python')}>
                      Open Settings
                    </Button>
                    <IconButton label="Dismiss notice" size="icon-xs" className="ml-auto" onClick={() => setDismissedBanner(banner)}>
                      <X />
                    </IconButton>
                  </div>
                )}
                <PinChangesBanner />
                <Workspace />
              </>
            )}
          </div>
          {settingsPage && <SettingsScreen />}
        </div>
      </SidebarProvider>
      <NewProjectDialog />
      <NoticeToast />
    </TooltipProvider>
  )
}

/** The store's notice: a deleted cell or a cell made a note, with Undo, or a bridge call that failed. */
function NoticeToast() {
  const notice = useNotebook((s) => s.notice)
  if (!notice) return null
  const { undo } = notice
  return (
    <div
      className="fixed bottom-5 left-1/2 z-40 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-[13px] text-background shadow-xl"
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="min-w-0">{notice.text}</span>
      <button
        type="button"
        className="shrink-0 font-medium text-background/70 hover:text-background"
        onClick={() => {
          undo?.()
          actions.dismissNotice()
        }}
      >
        {undo ? 'Undo' : 'Dismiss'}
      </button>
    </div>
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

/** Below this window width a side pane floats over the notebook instead of taking a column from it. */
const NARROW_WINDOW = '(max-width: 1199px)'

/**
 * The overview, the open side pane and the notebook, left to right, with draggable gaps between them.
 * The overview sits in its own group, so opening or closing a side pane never changes its width.
 * Cmd+B hides the overview and the side pane together, leaving the notebook.
 * In a narrow window the side pane opens over the notebook, so the notebook keeps its width.
 */
function Workspace() {
  const { open, openMobile, isMobile } = useSidebar()
  const pane = useNotebook((s) => s.pane)
  const narrow = useMediaQuery(NARROW_WINDOW)
  const visible = isMobile ? openMobile : open
  const docked = visible && pane != null && !narrow
  const outer = useDefaultLayout({ id: 'dalliance-overview', panelIds: visible ? ['overview', 'main'] : ['main'], storage: layoutStorage })
  const inner = useDefaultLayout({ id: 'dalliance-panes', panelIds: docked ? ['side', 'notebook'] : ['notebook'], storage: layoutStorage })
  return (
    <ResizablePanelGroup orientation="horizontal" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged} className="min-h-0 flex-1 px-2 pb-2">
      {visible && (
        <>
          <ResizablePanel id="overview" defaultSize={272} minSize={220} maxSize={420} groupResizeBehavior="preserve-pixel-size" className="flex">
            <ErrorBoundary what="The overview" className="flex-1 bg-background">
              <Sidebar />
            </ErrorBoundary>
          </ResizablePanel>
          <Gap />
        </>
      )}
      <ResizablePanel id="main" minSize={360} className="relative flex">
        <ResizablePanelGroup orientation="horizontal" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
          {docked && (
            <>
              <ResizablePanel id="side" defaultSize={380} minSize={280} maxSize={680} groupResizeBehavior="preserve-pixel-size" className="flex">
                <SidePane />
              </ResizablePanel>
              <Gap />
            </>
          )}
          <ResizablePanel id="notebook" minSize={360} className="flex">
            <NotebookView />
          </ResizablePanel>
        </ResizablePanelGroup>
        {visible && pane != null && narrow && <PaneOverlay />}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/**
 * The side pane over the notebook's left edge, for windows too narrow for both. Esc or a click on the
 * notebook closes it. Closed from the keyboard, focus goes back where it was; closed by a click, it stays
 * with the notebook so command mode works there at once.
 */
function PaneOverlay() {
  const ref = useRef<HTMLDivElement>(null)
  const clickedAway = useRef(false)
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const box = ref.current
    if (box && !box.contains(document.activeElement)) box.focus()
    return () => {
      if (clickedAway.current || !returnTo?.isConnected) return
      if (!document.activeElement || document.activeElement === document.body) returnTo.focus()
    }
  }, [])
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="pane-scrim"
        className="absolute inset-0 z-20 rounded-xl bg-black/10 dark:bg-black/30"
        onMouseDown={() => {
          clickedAway.current = true
          actions.openPane(null)
        }}
      />
      <div ref={ref} tabIndex={-1} className="absolute inset-y-0 left-0 z-30 flex w-[min(400px,calc(100%-48px))] rounded-xl shadow-2xl outline-none">
        <SidePane />
      </div>
    </>
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

const TEXT_FIELD = 'textarea, input, [contenteditable="true"], [contenteditable=""]'

// The Edit menu's accelerator and the page's keydown can both see one Cmd+Z, depending on the platform.
// Whichever comes second within a moment is the same key press, and is ignored.
let lastEdit: { which: 'undo' | 'redo'; from: 'menu' | 'key'; at: number } | null = null

function notebookEdit(which: 'undo' | 'redo', from: 'menu' | 'key') {
  const now = performance.now()
  if (lastEdit && lastEdit.which === which && lastEdit.from !== from && now - lastEdit.at < 150) return
  lastEdit = { which, from, at: now }
  if (which === 'undo') actions.undo()
  else actions.redo()
}

/**
 * Edit > Undo and Redo. A text field keeps its own undo, which the menu's items have to ask for since they
 * replace the built-in roles. Anywhere else they undo notebook edits.
 */
function editFromMenu(which: 'undo' | 'redo') {
  const el = document.activeElement
  if (el instanceof HTMLElement && el.matches(TEXT_FIELD)) {
    document.execCommand(which)
    return
  }
  const { screen, settingsPage } = useNotebook.getState()
  if (screen === 'notebook' && !settingsPage) notebookEdit(which, 'menu')
}

/**
 * Jupyter's command mode: when no editor has focus, single keys act on the selected cell.
 * A/B insert above/below, M/Y switch to note/prompt, T folds tables, D D deletes, arrows or J/K move, Enter edits,
 * Cmd+Z and Shift+Cmd+Z undo and redo notebook edits.
 * It listens only while focus is in the notebook or on nothing at all, so keys pressed on a button in the
 * overview or a side pane never act on the selected cell.
 */
function useCommandMode() {
  useEffect(() => {
    let lastD = 0
    // A new window starts with no recent edit, so an Undo left over from the last one can't swallow the first
    lastEdit = null
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented) return
      if (useNotebook.getState().screen !== 'notebook' || useNotebook.getState().settingsPage) return
      if (target !== document.body && target !== document.documentElement && !target.closest('[data-command-scope]')) return
      if (target.closest(`${TEXT_FIELD}, [role="dialog"], [role="alertdialog"], [role="listbox"]`)) return
      if (target.closest('button, a, summary, [role="tab"]') && (e.key === 'Enter' || e.key === ' ')) return
      const key = e.key
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key.toLowerCase() === 'z') {
        e.preventDefault()
        notebookEdit(e.shiftKey ? 'redo' : 'undo', 'key')
        return
      }
      const { selectedId, notebook } = useNotebook.getState()
      if (!selectedId) return
      const index = notebook.cells.findIndex((c) => c.id === selectedId)
      if (index < 0) return
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
          actions.deleteCell(selectedId)
          lastD = 0
        } else lastD = Date.now()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
