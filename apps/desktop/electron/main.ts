import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BaseWindow, type IpcMainEvent, type IpcMainInvokeEvent, WebContentsView, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import {
  type AccountView,
  type BillingView,
  type DocumentState,
  type DraftState,
  IPC,
  type KeyProvider,
  type MenuAction,
  type OpenedNotebook,
  type RenameResult,
  type RecentNotebook,
  type RunCellRequest,
  type SettingsUpdate,
  type TabsState,
} from '@dalliance/shared/ipc'
import { fromIpynb, toIpynb } from '@dalliance/shared/ipynb'
import type { Notebook } from '@dalliance/shared/notebook'
import { writeFileAtomic } from './atomic-write'
import { createRunLog } from './harness/extensions'
import { Account } from './cloud/account'
import { Billing } from './cloud/billing'
import { type CloudConfig, DESKTOP_SCHEME, cloudUrl, deepLinkFromArgv, fetchCloudConfig } from './cloud/config'
import { checkKey, listModels } from './harness/model'
import { DraftStore, type SavedTab } from './draft'
import { type AppPage, isTrustedSender } from './ipc-sender'
import { type TabCommand, buildMenu } from './menu'
import { folderForNewNotebook, newNotebookPath, notebookPathIn, renameNotebookFile } from './notebook-files'
import { OpenQueue, notebookFromArgv } from './open-files'
import { NotebookSession, type SharedPythonState } from './session'
import { ENV_KEYS, SettingsStore } from './settings'
import { readShellEnv } from './shell-env'
import { type CloseChoice, type Tab as TabOf, Tabs, tabTitle } from './tabs'

type Tab = TabOf<WebContentsView, NotebookSession>

const isMac = process.platform === 'darwin'
const TITLE_BAR_HEIGHT = 48

// One copy of the app at a time. A second launch hands its command line to this one through 'second-instance'
// and quits without reading shell keys or registering anything.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

// In development, read keys from .env in the project folder
const envFile = path.join(app.getAppPath(), '.env')
if (!app.isPackaged && existsSync(envFile)) process.loadEnvFile(envFile)

let win: BaseWindow | null = null
// Set once every tab has answered the close dialog, so the next close goes through
let allowClose = false
// Set while the close dialog walks the tabs, so a second close doesn't start a second walk
let closing = false
// The close came from quitting, so once every tab has answered, the app quits rather than only closing the window
let quitting = false

const settings = new SettingsStore(app.getPath('userData'))
// Keys exported in the user's shell profile. Settings wait for this, so the first view already counts them.
const shellKeys = primary ? readShellEnv(Object.values(ENV_KEYS)).then((env) => settings.useShellKeys(env)) : Promise.resolve()
const drafts = new DraftStore(app.getPath('userData'))
// Unsaved notebooks run in their own folder, never in all of Documents
const defaultWorkspace = path.join(app.getPath('documents'), 'Dalliance Notebooks')
mkdirSync(defaultWorkspace, { recursive: true })
// Tabs running at once write one agent.jsonl, each line naming its tab
const runLog = createRunLog(path.join(app.getPath('userData'), 'logs'))
// Every tab runs on the same Python
const sharedPython: SharedPythonState = { baseChecked: false }
// Dalliance Cloud: the account, the plan and hosted models, in builds made with a Cloud URL. Without one, like a
// fork's build, none of it runs and models use the user's own key. See docs/cloud.md. The auth client gets no window:
// its IPC bridges are off, and account changes reach every tab through watchCloud()
const cloud = primary ? cloudUrl(app.isPackaged) : null
const account = cloud ? new Account({ userData: app.getPath('userData'), cloud, getWindow: () => null }) : null
let cloudConfig: Promise<CloudConfig> | null = null
const billing =
  cloud && account
    ? new Billing({
        // Asked once and kept. A failure is forgotten, so the next attempt asks again
        convexUrl: async () => {
          cloudConfig ??= fetchCloudConfig(cloud).catch((err: unknown) => {
            cloudConfig = null
            throw err
          })
          return (await cloudConfig).convexUrl
        },
        token: () => account.convexToken(),
        open: (url) => shell.openExternal(url),
      })
    : null
if (cloud && account) settings.setCloud({ baseURL: `${cloud}/api/ai`, signedIn: () => account.signedIn, token: () => account.convexToken() })

const SIGNED_OUT: AccountView = { user: null, checking: false, waiting: false, error: null }
const NO_BILLING: BillingView = { available: false, plans: [], subscription: null, usage: null, loading: false, checkingOut: false, error: null }


/** Paths from the renderer are only trusted to name a notebook file. Anything else goes through the Save dialog. */
const isNotebookPath = (file: unknown): file is string => typeof file === 'string' && path.isAbsolute(file) && /\.ipynb$/i.test(file)

// The page every tab loads. IPC is only answered for this page, in a tab view's top frame.
const indexFile = path.join(import.meta.dirname, '../dist/index.html')
const appPage: AppPage = { devServerUrl: process.env.VITE_DEV_SERVER_URL, indexFile }

// The window canvas behind the panes, in each theme. Matches --canvas in index.css.
const canvas = () => (nativeTheme.shouldUseDarkColors ? { color: '#111110', symbolColor: '#a1a09a' } : { color: '#efeeeb', symbolColor: '#6f6e69' })

function sendTo(tab: Tab | null | undefined, channel: string, ...args: unknown[]) {
  const contents = tab?.view.webContents
  if (contents && !contents.isDestroyed()) contents.send(channel, ...args)
}

/** Settings, the Python and its setup log belong to the whole app, so every tab hears about them. */
function broadcast(channel: string, ...args: unknown[]) {
  for (const tab of tabs.all) sendTo(tab, channel, ...args)
}

/** Menu actions go to the tab that is showing. */
const sendMenu = (action: MenuAction) => sendTo(tabs.active, IPC.menu, action)

const tabs: Tabs<WebContentsView, NotebookSession> = new Tabs({
  createView,
  createSession: (id) =>
    new NotebookSession({
      settings,
      userData: app.getPath('userData'),
      defaultWorkspace,
      tabId: id,
      log: runLog,
      shared: sharedPython,
      send: (channel, ...args) => (channel === IPC.pythonLog ? broadcast(channel, ...args) : sendTo(tabs.byId(id), channel, ...args)),
    }),
  show: (view) => {
    if (!win) return
    win.contentView.addChildView(view)
    layout()
    view.webContents.focus()
  },
  hide: (view) => win?.contentView.removeChildView(view),
  dispose: (tab) => {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    void tab.session.shutdown()
    drafts.close(tab.id)
  },
  askToSave,
  requestSave: (tab) => sendTo(tab, IPC.menu, 'save'),
  forgetChanges: (tab) => drafts.forgetChanges(tab.id),
  closeWindow: () => win?.close(),
  changed: tabsChanged,
})

// Notebooks the OS asked to open. The page of the tab that is showing runs its own Open for each, so the notebook
// lands in that tab when it's an untouched Untitled, and in a new tab otherwise.
const opens = new OpenQueue(() => sendMenu('open'))

/** The queue may ask the tab that is showing once its page takes menu actions. */
const syncOpens = () => opens.setReady(tabs.active?.menuReady ?? false)

function tabsState(tab: Tab): TabsState {
  return { tabs: tabs.info(), activeId: tabs.active?.id ?? null, selfId: tab.id }
}

function tabsChanged() {
  drafts.arrange(tabs.all.map((t) => t.id), tabs.active?.id ?? null)
  for (const tab of tabs.all) sendTo(tab, IPC.tabsChanged, tabsState(tab))
  updateTitle()
  syncOpens()
}

/** The active view fills the window's content area. */
function layout() {
  const view = tabs.active?.view
  if (!win || !view) return
  const [width, height] = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width, height })
}

/** A tab's page: today's renderer, sandboxed, with the same guards the window's own page had. */
function createView(id: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  view.setBackgroundColor(canvas().color)
  const contents = view.webContents
  // Links open in the default browser, never in a new Electron window
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event) => event.preventDefault())
  // Until the page subscribes to menu actions again, a file the OS asks to open waits, and a close waiting on a save stops
  const reset = () => {
    const tab = tabs.byId(id)
    if (!tab) return
    tabs.pageReset(tab)
    syncOpens()
  }
  contents.on('did-start-loading', reset)
  contents.on('render-process-gone', reset)
  if (appPage.devServerUrl) void contents.loadURL(appPage.devServerUrl)
  else void contents.loadFile(indexFile)
  return view
}

/**
 * A new tab, shown unless `show` is false. `saved` is what the last run left in it, `draft` a notebook just opened
 * for it. With neither, its page shows the start page.
 */
function openTab({ saved, draft, show = true }: { saved?: SavedTab; draft?: DraftState; show?: boolean } = {}): Tab {
  const doc = saved ?? draft
  const tab = tabs.create({ doc: doc ? { path: doc.path, dirty: doc.dirty } : undefined, show })
  drafts.open(tab.id, saved ?? null)
  if (draft) drafts.update(tab.id, draft)
  return tab
}

async function askToSave(tab: Tab): Promise<CloseChoice> {
  if (!win) return 'cancel'
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to “${tabTitle(tab.doc.path)}” before closing?`,
    detail: "Your changes will be lost if you don't save them.",
  })
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
}

/** A notebook the app opened or saved goes on the recent lists: settings, the Dock, and File > Open Recent. */
function remember(file: string) {
  app.addRecentDocument(file)
  settings.addRecent(file)
  refreshMenu()
}

function refreshMenu() {
  buildMenu({
    send: sendMenu,
    tab: tabCommand,
    openRecent: (file) => {
      if (!existsSync(file)) {
        settings.removeRecent(file)
        refreshMenu()
        return
      }
      openFromOs(file)
    },
    recent: settings.recent.filter((r) => existsSync(r.path)).map((r) => ({ path: r.path, name: path.basename(r.path, '.ipynb') })),
  })
}

function tabCommand(command: TabCommand) {
  if (!win) {
    // macOS keeps the app running without a window. A new tab makes one.
    if (command === 'new-tab') createWindow()
    return
  }
  if (command === 'new-tab') openTab()
  else if (command === 'close-tab' && tabs.active) void tabs.close(tabs.active)
  else if (command === 'next-tab') tabs.cycle(1)
  else if (command === 'previous-tab') tabs.cycle(-1)
  else if (command === 'close-window') win.close()
}

/**
 * Where an opened notebook goes: into the calling tab when it's an untouched Untitled, with a fresh kernel in `dir`,
 * and the caller loads what this returns. Otherwise into a new tab, and the result is null.
 */
async function place(caller: Tab, opened: { path: string; notebook: Notebook }, dir: string): Promise<OpenedNotebook | null> {
  const draft: DraftState = { path: opened.path, dirty: false, notebook: opened.notebook }
  if (tabs.placement(caller, null).to === 'here') {
    await caller.session.openWorkspace(dir)
    drafts.update(caller.id, draft)
    // Now, not when the page reports it, so a second open straight after doesn't take this tab too
    tabs.report(caller, { path: opened.path, dirty: false, running: caller.doc.running })
    return opened
  }
  const tab = openTab({ draft })
  await tab.session.openWorkspace(dir)
  return null
}

/** Open a notebook file. A tab that has it open already comes forward instead. */
async function openFile(caller: Tab, file: string): Promise<OpenedNotebook | null> {
  const placement = tabs.placement(caller, file)
  if (placement.to === 'existing') {
    tabs.activate(placement.tab)
    return null
  }
  const notebook = fromIpynb(JSON.parse(await readFile(file, 'utf-8')))
  remember(file)
  return place(caller, { path: file, notebook }, path.dirname(file))
}

const ipynbText = (notebook: Notebook) => `${JSON.stringify(toIpynb(notebook), null, 1)}\n`

/**
 * Write a notebook under the first free "Untitled" name in `dir`. The `wx` flag never overwrites a file that
 * appeared after the name was picked: that name is skipped and the next free one tried.
 */
async function writeNewNotebook(dir: string, notebook: Notebook): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const file = newNotebookPath(dir)
    try {
      await writeFile(file, ipynbText(notebook), { flag: 'wx' })
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 4) throw err
    }
  }
}

/**
 * A new notebook is a file from the start, in the folder it was made for, with a fresh kernel there. When the folder
 * can't be written to, the reason is shown in a dialog and the result is null, so the window stays as it was.
 */
async function createNotebook(caller: Tab, dir: string, notebook: Notebook): Promise<OpenedNotebook | null> {
  try {
    // The folder may have been moved or deleted since it was chosen
    await mkdir(dir, { recursive: true })
    const file = await writeNewNotebook(dir, notebook)
    const opened = await place(caller, { path: file, notebook }, dir)
    // Only once the notebook is really open, so a failure above leaves no recent entry behind
    remember(file)
    return opened
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
    if (win) await dialog.showMessageBox(win, { type: 'error', message: "Couldn't create a notebook here", detail: `${dir}\n${detail}` })
    return null
  }
}

function createWindow() {
  allowClose = false
  closing = false
  win = new BaseWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Dalliance',
    backgroundColor: canvas().color,
    show: false,
    // The renderer draws its own top bar. macOS keeps native traffic lights,
    // Windows and Linux get native window controls drawn over the bar.
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { ...canvas(), height: TITLE_BAR_HEIGHT } }),
  })

  win.on('resize', layout)
  // Keyboard input goes to the tab that is showing
  win.on('focus', () => tabs.active?.view.webContents.focus())
  const onTheme = () => {
    if (!win || win.isDestroyed()) return
    win.setBackgroundColor(canvas().color)
    for (const tab of tabs.all) tab.view.setBackgroundColor(canvas().color)
    if (!isMac) win.setTitleBarOverlay({ ...canvas(), height: TITLE_BAR_HEIGHT })
  }
  nativeTheme.on('updated', onTheme)

  win.on('close', (event) => {
    if (allowClose || !tabs.anyDirty) return
    event.preventDefault()
    if (closing) return
    closing = true
    void tabs
      .confirmAll()
      .catch(() => false)
      .then((ok) => {
        closing = false
        if (!ok) {
          quitting = false
          return
        }
        allowClose = true
        if (quitting) app.quit()
        else win?.close()
      })
  })
  win.on('closed', () => {
    nativeTheme.off('updated', onTheme)
    // Written with every tab, so the next window or launch brings them back. The kernels go with the window.
    drafts.flush()
    for (const tab of tabs.clear()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      void tab.session.shutdown()
    }
    drafts.clear()
    win = null
    opens.setReady(false)
  })

  // Bring back the tabs the last run left open, or start with one on the start page
  const saved = drafts.read()
  const restored = saved.tabs.map((entry) => openTab({ saved: entry, show: false }))
  if (restored.length) tabs.activate(restored[saved.active] ?? restored[0])
  else openTab()

  const reveal = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show()
  }
  tabs.active?.view.webContents.once('did-finish-load', reveal)
  tabs.active?.view.webContents.once('did-fail-load', reveal)
}

/** Bring the window forward, or make one when macOS kept the app running without any. */
function showWindow() {
  if (!app.isReady()) return
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * A link on the app's scheme, from the browser. A sign-in link redeems its code; `io.dalliance.app://billing`,
 * from the page after checkout, only brings the app forward. Builds without Dalliance Cloud ignore them all.
 */
function openLink(link: string) {
  if (!account) return
  account.handleLink(link)
  showWindow()
}

/** A file from Finder, the Dock, a second launch or Open Recent. A tab that has it comes forward, else it opens as if picked in the Open dialog. */
function openFromOs(file: string | null) {
  const existing = file ? tabs.byPath(file) : null
  if (existing) tabs.activate(existing)
  else if (file) opens.request(file)
  showWindow()
}

function updateTitle() {
  if (!win || win.isDestroyed()) return
  const doc = tabs.active?.doc ?? { path: null, dirty: false }
  win.setTitle(`${doc.path ? path.basename(doc.path) : 'Untitled'}${doc.dirty ? ' (edited)' : ''} · Dalliance`)
  if (isMac) {
    win.setRepresentedFilename(doc.path ?? '')
    win.setDocumentEdited(doc.dirty)
  }
}

/** IPC from anything but the app's own page in one of its tab views is refused. See electron/ipc-sender.ts. */
function trustedTab(channel: string, event: IpcMainEvent | IpcMainInvokeEvent): Tab | null {
  if (isTrustedSender(event, tabs.all.map((t) => t.view), appPage)) return tabs.find((t) => t.view.webContents.id === event.sender.id)
  console.warn(`Refused IPC on ${channel} from ${event.senderFrame?.url ?? 'a frame that is gone'}`)
  return null
}

/** Every handler gets the tab whose page sent the call. */
function handle<A extends unknown[]>(channel: string, listener: (tab: Tab, ...args: A) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    const tab = trustedTab(channel, event)
    if (!tab) throw new Error('This page is not allowed to call Dalliance.')
    return listener(tab, ...(args as A))
  })
}

function on<A extends unknown[]>(channel: string, listener: (tab: Tab, ...args: A) => void) {
  ipcMain.on(channel, (event, ...args) => {
    const tab = trustedTab(channel, event)
    if (tab) listener(tab, ...(args as A))
  })
}

function registerIpc() {
  handle(IPC.runCell, (tab, request: RunCellRequest) => tab.session.runCell(request, tab.view.webContents))
  on(IPC.respond, (tab, requestId: string, answer: string | boolean | null) => tab.session.respond(requestId, answer))
  handle(IPC.interrupt, (tab) => tab.session.interrupt())
  handle(IPC.restartKernel, (tab) => tab.session.restart())
  handle(IPC.kernelState, (tab) => tab.session.kernelState())
  handle(IPC.listVariables, (tab) => tab.session.variables())
  handle(IPC.listPackages, (tab) => tab.session.environment())
  handle(IPC.getSettings, async () => {
    await shellKeys
    return settings.view()
  })
  handle(IPC.listModels, async () => {
    await shellKeys
    return listModels(settings.modelConfig())
  })
  handle(IPC.checkKey, (_tab, provider: KeyProvider, key: string) => {
    if ((provider !== 'gateway' && provider !== 'anthropic') || typeof key !== 'string') throw new Error('Not a provider that takes a key.')
    return checkKey(provider, key)
  })
  handle(IPC.updateSettings, async (tab, update: SettingsUpdate) => {
    const pythonChanged = update.pythonPath !== undefined && update.pythonPath !== settings.pythonPath
    const view = settings.update(update)
    if (pythonChanged) {
      // Every tab runs on the one Python, so every kernel in use restarts on the new one
      await Promise.all(tabs.all.map((t) => t.session.pythonChanged()))
      broadcast(IPC.pythonStateChanged, await tab.session.pythonState())
    }
    broadcast(IPC.settingsChanged, view)
    return view
  })
  handle(IPC.pythonState, (tab) => tab.session.pythonState())
  handle(IPC.setupPython, async (tab) => {
    const state = await tab.session.setupPython()
    await Promise.all(tabs.all.map((t) => t.session.pythonChanged()))
    broadcast(IPC.pythonStateChanged, state)
    return state
  })

  handle(IPC.openNotebook, async (tab) => {
    if (!win) return null
    // A file the OS asked to open takes the dialog's place
    const requested = opens.take()
    if (requested) {
      try {
        return await openFile(tab, requested)
      } catch (err) {
        void dialog.showMessageBox(win, {
          type: 'warning',
          message: `Couldn't open ${path.basename(requested)}`,
          detail: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open notebook',
      defaultPath: tab.session.dir,
      filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    return openFile(tab, filePaths[0])
  })

  // A notebook opened straight from Documents makes it the folder in use, but new ones still never land there
  handle(IPC.newNotebook, (tab, notebook: Notebook) => createNotebook(tab, folderForNewNotebook(tab.session.dir, defaultWorkspace), notebook))

  handle(IPC.openFolder, async (tab, notebook: Notebook) => {
    if (!win) return null
    // On macOS the dialog's New Folder button makes a folder and picks it in one go
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for your notebooks',
      buttonLabel: 'Use folder',
      defaultPath: tab.session.dir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || !filePaths[0]) return null
    return createNotebook(tab, filePaths[0], notebook)
  })

  handle(IPC.openRecent, async (tab, file: string) => {
    // Only a notebook the app itself put on the list, never an arbitrary path from the window
    if (!settings.recent.some((r) => r.path === file)) return null
    if (!existsSync(file)) {
      settings.removeRecent(file)
      refreshMenu()
      return null
    }
    return openFile(tab, file)
  })

  handle(IPC.recentNotebooks, (): RecentNotebook[] =>
    settings.recent
      .filter((r) => existsSync(r.path))
      .map((r) => ({ path: r.path, name: path.basename(r.path, '.ipynb'), folder: path.basename(path.dirname(r.path)), openedAt: r.openedAt })),
  )
  handle(IPC.readBrief, (tab) => tab.session.readBrief())
  handle(IPC.writeBrief, (tab, text: string) => tab.session.writeBrief(text))
  handle(IPC.listFiles, (tab) => tab.session.files())

  handle(IPC.saveNotebook, async (tab, current: string | null, notebook: Notebook) => {
    if (!win) return null
    let saved = false
    try {
      let file = isNotebookPath(current) ? current : null
      if (!file) {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: 'Save notebook',
          defaultPath: path.join(tab.session.dir, 'Untitled.ipynb'),
          filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
        })
        if (canceled || !filePath) return null
        file = filePath.endsWith('.ipynb') ? filePath : `${filePath}.ipynb`
      }
      // A crash or a full disk mid-save leaves the old file, never a truncated one
      await writeFileAtomic(file, ipynbText(notebook))
      remember(file)
      // Record the save now: the tab or the window may close before the renderer reports it
      drafts.update(tab.id, { path: file, dirty: false, notebook })
      drafts.flush()
      tabs.report(tab, { path: file, dirty: false, running: tab.doc.running })
      await tab.session.moveWorkspace(path.dirname(file))
      saved = true
      return file
    } finally {
      // A close waiting on this save goes ahead only if it landed. Cancelled or failed, it stops, and either way a
      // later ordinary Save never closes anything.
      tabs.finishSave(tab, saved)
    }
  })

  handle(IPC.renameNotebook, async (tab, current: string | null, name: string, notebook: Notebook): Promise<RenameResult> => {
    try {
      if (current !== null) {
        // Only ever a notebook file: the window names what to rename, so any other path is refused
        if (!isNotebookPath(current)) return { error: "Couldn't rename the notebook: that isn't a notebook file." }
        const renamed = await renameNotebookFile(current, name)
        if ('error' in renamed) return renamed
        if (renamed.path !== current) {
          settings.removeRecent(current)
          remember(renamed.path)
          // The draft keeps the edits as they are: a rename doesn't save them
          drafts.update(tab.id, { path: renamed.path, dirty: tab.doc.dirty, notebook })
          tabs.report(tab, { ...tab.doc, path: renamed.path })
        }
        return { path: renamed.path, saved: false }
      }
      // A notebook that was never a file is written under its new name, where a new notebook would go.
      // wx: a file that appeared under that name since the check is never overwritten.
      const dir = folderForNewNotebook(tab.session.dir, defaultWorkspace)
      await mkdir(dir, { recursive: true })
      const target = notebookPathIn(dir, name)
      if ('error' in target) return target
      try {
        await writeFile(target.path, ipynbText(notebook), { flag: 'wx' })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { error: `There is already a notebook called "${path.basename(target.path, '.ipynb')}" in this folder.` }
        throw err
      }
      await tab.session.moveWorkspace(dir)
      remember(target.path)
      drafts.update(tab.id, { path: target.path, dirty: false, notebook })
      drafts.flush()
      return { path: target.path, saved: true }
    } catch (err) {
      return { error: `Couldn't rename the notebook: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` }
    }
  })

  handle(IPC.restoreSession, async (tab) => {
    // The second ask from the same tab is a reload of its page
    const reload = tab.restored
    tab.restored = true
    const restored = drafts.restore(tab.id, reload)
    // Nothing to reopen, or a notebook that won't open: the renderer shows the start page, with the reason if any
    if (!restored || !('notebook' in restored)) return restored
    // After a reload nothing is left to receive a running cell's result, so stop it rather than let it run unseen
    if (restored.kernelKept) tab.session.interrupt()
    // Tabs brought back behind the one showing don't change the folder the next launch starts in
    else if (restored.path) await tab.session.openWorkspace(path.dirname(restored.path), { remember: tab === tabs.active })
    return restored
  })
  on(IPC.saveDraft, (tab, state: DraftState) => drafts.update(tab.id, state))
  // The page subscribed to menu actions, so a queued file can go through its Open
  on(IPC.menuReady, (tab) => {
    tab.menuReady = true
    syncOpens()
  })
  on(IPC.documentState, (tab, state: DocumentState) => tabs.report(tab, state))

  handle(IPC.listTabs, (tab) => tabsState(tab))
  handle(IPC.newTab, () => {
    openTab()
  })
  handle(IPC.closeTab, async (_tab, id: string) => {
    const target = tabs.byId(id)
    if (target) await tabs.close(target)
  })
  handle(IPC.switchTab, (_tab, id: string) => {
    const target = tabs.byId(id)
    if (target) tabs.activate(target)
  })

  // Dalliance Cloud. Builds without it answer signed out, with billing unavailable
  handle(IPC.getAccount, () => account?.current ?? SIGNED_OUT)
  handle(IPC.signIn, () => account?.signIn() ?? SIGNED_OUT)
  handle(IPC.redeemSignInCode, (_e, code: string) => (account && typeof code === 'string' ? account.redeem(code) : (account?.current ?? SIGNED_OUT)))
  handle(IPC.signOut, () => account?.signOut() ?? SIGNED_OUT)
  handle(IPC.getBilling, () => billing?.current ?? NO_BILLING)
  handle(IPC.startCheckout, (_e, plan: string) => (billing && plan === 'pro' ? billing.checkout(plan) : (billing?.current ?? NO_BILLING)))
  handle(IPC.openBillingPortal, () => billing?.portal() ?? NO_BILLING)
  handle(IPC.countCredits, (_e, ids: unknown) => {
    const generationIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    return billing ? billing.credits(generationIds) : null
  })
}

/** Sends account and plan changes to the page, and keeps the plan following the account. */
function watchCloud() {
  if (!account || !billing) return
  // The account and the plan are the app's, so every tab hears about them
  account.onChange((view) => {
    billing.setSignedIn(view.user != null)
    broadcast(IPC.accountChanged, view)
  })
  billing.onChange((view) => broadcast(IPC.billingChanged, view))
  void account.refresh()
  void billing.connect()
}

/** Makes the OS send links on the app's scheme here. Packaged builds also list it in electron-builder's protocols. */
function registerScheme() {
  // Development runs the Electron binary on the project folder, so the OS has to be told to pass that folder too
  const registered =
    process.defaultApp && process.argv[1]
      ? app.setAsDefaultProtocolClient(DESKTOP_SCHEME, process.execPath, [path.resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient(DESKTOP_SCHEME)
  if (!registered) console.warn(`Couldn't register ${DESKTOP_SCHEME}: links, so sign-in has to finish with the code from the page.`)
}

if (primary) {
  // macOS sends files from Finder and the Dock here, at launch before 'ready' too, so this is registered early
  app.on('open-file', (event, file) => {
    event.preventDefault()
    if (isNotebookPath(file)) openFromOs(file)
  })
  // A second launch, with or without a file. Windows and Linux pass a double-clicked file on the command line,
  // and a link on the app's scheme the same way
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const link = deepLinkFromArgv(argv)
    if (link) return openLink(link)
    openFromOs(notebookFromArgv(argv, workingDirectory))
  })
  const launchFile = notebookFromArgv(process.argv, process.cwd())
  if (launchFile) opens.request(launchFile)

  if (account) {
    // macOS sends links here, at launch before 'ready' too
    app.on('open-url', (event, url) => {
      event.preventDefault()
      void app.whenReady().then(() => openLink(url))
    })
    registerScheme()
    const launchLink = deepLinkFromArgv(process.argv)
    if (launchLink) void app.whenReady().then(() => openLink(launchLink))
  }

  void app.whenReady().then(() => {
    registerIpc()
    refreshMenu()
    createWindow()
    watchCloud()
    // Only the tab showing at launch starts its kernel straight away. The others start theirs on their first run.
    tabs.active?.session.warmUp()
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    drafts.flush()
  })

  // Not in before-quit: the close dialog can still cancel the quit, and the notebooks would stay open with dead kernels
  app.on('will-quit', () => {
    drafts.flush()
    billing?.close()
    for (const tab of tabs.all) void tab.session.shutdown()
  })
}
