import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import {
  type AccountView,
  type BillingView,
  type DraftState,
  IPC,
  type KeyProvider,
  type MenuAction,
  type OpenedNotebook,
  type RenameResult,
  type RecentNotebook,
  type RunCellRequest,
  type SettingsUpdate,
} from '@dalliance/shared/ipc'
import { fromIpynb, toIpynb } from '@dalliance/shared/ipynb'
import type { Notebook } from '@dalliance/shared/notebook'
import { writeFileAtomic } from './atomic-write'
import { Account } from './cloud/account'
import { Billing } from './cloud/billing'
import { type CloudConfig, DESKTOP_SCHEME, cloudUrl, deepLinkFromArgv, fetchCloudConfig } from './cloud/config'
import { checkKey, listModels } from './harness/model'
import { DraftStore } from './draft'
import { type AppPage, isTrustedSender } from './ipc-sender'
import { buildMenu } from './menu'
import { folderForNewNotebook, newNotebookPath, notebookPathIn, renameNotebookFile } from './notebook-files'
import { OpenQueue, notebookFromArgv } from './open-files'
import { NotebookSession } from './session'
import { ENV_KEYS, SettingsStore } from './settings'
import { readShellEnv } from './shell-env'

const isMac = process.platform === 'darwin'
const TITLE_BAR_HEIGHT = 48

// One copy of the app at a time. A second launch hands its command line to this one through 'second-instance'
// and quits without reading shell keys or registering anything.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

// In development, read keys from .env in the project folder
const envFile = path.join(app.getAppPath(), '.env')
if (!app.isPackaged && existsSync(envFile)) process.loadEnvFile(envFile)

let win: BrowserWindow | null = null
let documentState = { path: null as string | null, dirty: false }
let allowClose = false
// Set when the close dialog chose Save: once the save lands, the window closes
let allowCloseAfterSave = false

const settings = new SettingsStore(app.getPath('userData'))
// Keys exported in the user's shell profile. Settings wait for this, so the first view already counts them.
const shellKeys = primary ? readShellEnv(Object.values(ENV_KEYS)).then((env) => settings.useShellKeys(env)) : Promise.resolve()
const drafts = new DraftStore(app.getPath('userData'))
// Unsaved notebooks run in their own folder, never in all of Documents
const defaultWorkspace = path.join(app.getPath('documents'), 'Dalliance Notebooks')
mkdirSync(defaultWorkspace, { recursive: true })
// Dalliance Cloud: the account, the plan and hosted models, in builds made with a Cloud URL. Without one, like a
// fork's build, none of it runs and models use the user's own key. See docs/cloud.md
const cloud = primary ? cloudUrl(app.isPackaged) : null
const account = cloud ? new Account({ userData: app.getPath('userData'), cloud, getWindow: () => win }) : null
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

const session = new NotebookSession({
  settings,
  userData: app.getPath('userData'),
  defaultWorkspace,
  send: (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  },
})

/** Paths from the renderer are only trusted to name a notebook file. Anything else goes through the Save dialog. */
const isNotebookPath = (file: unknown): file is string => typeof file === 'string' && path.isAbsolute(file) && /\.ipynb$/i.test(file)

const sendMenu = (action: MenuAction) => win?.webContents.send(IPC.menu, action)

// The page the window loads. IPC is only answered for this page, in the window's top frame.
const indexFile = path.join(import.meta.dirname, '../dist/index.html')
const appPage: AppPage = { devServerUrl: process.env.VITE_DEV_SERVER_URL, indexFile }

// Notebooks the OS asked to open. The renderer runs its own Open for each, Discard prompt included.
const opens = new OpenQueue(() => sendMenu('open'))

// The window canvas behind the panes, in each theme. Matches --canvas in index.css.
const canvas = () => (nativeTheme.shouldUseDarkColors ? { color: '#111110', symbolColor: '#a1a09a' } : { color: '#efeeeb', symbolColor: '#6f6e69' })

async function openFile(file: string): Promise<OpenedNotebook> {
  const notebook = fromIpynb(JSON.parse(await readFile(file, 'utf-8')))
  app.addRecentDocument(file)
  settings.addRecent(file)
  await session.openWorkspace(path.dirname(file))
  drafts.update({ path: file, dirty: false, notebook })
  return { path: file, notebook }
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
async function createNotebook(dir: string, notebook: Notebook): Promise<OpenedNotebook | null> {
  try {
    // The folder may have been moved or deleted since it was chosen
    await mkdir(dir, { recursive: true })
    const file = await writeNewNotebook(dir, notebook)
    await session.openWorkspace(dir)
    // Only once the notebook is really open, so a failure above leaves no recent entry behind
    app.addRecentDocument(file)
    settings.addRecent(file)
    drafts.update({ path: file, dirty: false, notebook })
    return { path: file, notebook }
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : String(err)
    if (win) await dialog.showMessageBox(win, { type: 'error', message: "Couldn't create a notebook here", detail: `${dir}\n${detail}` })
    return null
  }
}

function createWindow() {
  win = new BrowserWindow({
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
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { ...canvas(), height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // Until the new page subscribes to menu actions, a file the OS asks to open waits
  opens.setReady(false)
  win.webContents.on('did-start-loading', () => opens.setReady(false))
  win.once('ready-to-show', () => win?.show())
  const onTheme = () => {
    if (!win || win.isDestroyed()) return
    win.setBackgroundColor(canvas().color)
    if (!isMac) win.setTitleBarOverlay({ ...canvas(), height: TITLE_BAR_HEIGHT })
  }
  nativeTheme.on('updated', onTheme)
  win.on('closed', () => nativeTheme.off('updated', onTheme))

  // Links open in the default browser, never in a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  win.on('close', (event) => {
    if (allowClose || !documentState.dirty || !win) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes to this notebook before closing?',
      detail: "Your changes will be lost if you don't save them.",
    })
    if (choice === 0) {
      allowCloseAfterSave = true
      sendMenu('save')
    }
    if (choice === 1) {
      // Don't Save means the next launch shouldn't bring these changes back
      drafts.forgetChanges()
      allowClose = true
      win.close()
    }
  })
  win.on('closed', () => {
    win = null
    opens.setReady(false)
  })

  if (appPage.devServerUrl) void win.loadURL(appPage.devServerUrl)
  else void win.loadFile(indexFile)
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

/** A file from Finder, the Dock or a second launch. It opens as if picked in the Open dialog. */
function openFromOs(file: string | null) {
  if (file) opens.request(file)
  showWindow()
}

function updateTitle() {
  if (!win) return
  const name = documentState.path ? path.basename(documentState.path) : 'Untitled'
  win.setTitle(`${name}${documentState.dirty ? ' (edited)' : ''} · Dalliance`)
  if (isMac) {
    win.setRepresentedFilename(documentState.path ?? '')
    win.setDocumentEdited(documentState.dirty)
  }
}

/** IPC from anything but the app's own page in its own window is refused. See electron/ipc-sender.ts. */
function trusted(channel: string, event: IpcMainEvent | IpcMainInvokeEvent) {
  if (isTrustedSender(event, win, appPage)) return true
  console.warn(`Refused IPC on ${channel} from ${event.senderFrame?.url ?? 'a frame that is gone'}`)
  return false
}

function handle<A extends unknown[]>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: A) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(channel, event)) throw new Error('This page is not allowed to call Dalliance.')
    return listener(event, ...(args as A))
  })
}

function on<A extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: A) => void) {
  ipcMain.on(channel, (event, ...args) => {
    if (trusted(channel, event)) listener(event, ...(args as A))
  })
}

function registerIpc() {
  handle(IPC.runCell, (event, request: RunCellRequest) => session.runCell(request, event.sender))
  on(IPC.respond, (_e, requestId: string, answer: string | boolean | null) => session.respond(requestId, answer))
  handle(IPC.interrupt, () => session.interrupt())
  handle(IPC.restartKernel, () => session.restart())
  handle(IPC.kernelState, () => session.kernelState())
  handle(IPC.listVariables, () => session.variables())
  handle(IPC.listPackages, () => session.environment())
  handle(IPC.getSettings, async () => {
    await shellKeys
    return settings.view()
  })
  handle(IPC.listModels, async () => {
    await shellKeys
    return listModels(settings.modelConfig())
  })
  handle(IPC.checkKey, (_e, provider: KeyProvider, key: string) => {
    if ((provider !== 'gateway' && provider !== 'anthropic') || typeof key !== 'string') throw new Error('Not a provider that takes a key.')
    return checkKey(provider, key)
  })
  handle(IPC.updateSettings, async (_e, update: SettingsUpdate) => {
    const pythonChanged = update.pythonPath !== undefined && update.pythonPath !== settings.pythonPath
    const view = settings.update(update)
    if (pythonChanged) await session.restart()
    return view
  })
  handle(IPC.pythonState, () => session.pythonState())
  handle(IPC.setupPython, () => session.setupPython())

  handle(IPC.openNotebook, async () => {
    if (!win) return null
    // A file the OS asked to open takes the dialog's place
    const requested = opens.take()
    if (requested) {
      try {
        return await openFile(requested)
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
      defaultPath: session.dir,
      filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    return openFile(filePaths[0])
  })

  // A notebook opened straight from Documents makes it the folder in use, but new ones still never land there
  handle(IPC.newNotebook, (_e, notebook: Notebook) => createNotebook(folderForNewNotebook(session.dir, defaultWorkspace), notebook))

  handle(IPC.openFolder, async (_e, notebook: Notebook) => {
    if (!win) return null
    // On macOS the dialog's New Folder button makes a folder and picks it in one go
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for your notebooks',
      buttonLabel: 'Use folder',
      defaultPath: session.dir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || !filePaths[0]) return null
    return createNotebook(filePaths[0], notebook)
  })

  handle(IPC.openRecent, async (_e, file: string) => {
    // Only a notebook the app itself put on the list, never an arbitrary path from the window
    if (!settings.recent.some((r) => r.path === file)) return null
    if (!existsSync(file)) {
      settings.removeRecent(file)
      return null
    }
    return openFile(file)
  })

  handle(IPC.recentNotebooks, (): RecentNotebook[] =>
    settings.recent
      .filter((r) => existsSync(r.path))
      .map((r) => ({ path: r.path, name: path.basename(r.path, '.ipynb'), folder: path.basename(path.dirname(r.path)), openedAt: r.openedAt })),
  )
  handle(IPC.readBrief, () => session.readBrief())
  handle(IPC.writeBrief, (_e, text: string) => session.writeBrief(text))
  handle(IPC.listFiles, () => session.files())

  handle(IPC.saveNotebook, async (_e, current: string | null, notebook: Notebook) => {
    if (!win) return null
    try {
      let file = isNotebookPath(current) ? current : null
      if (!file) {
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: 'Save notebook',
          defaultPath: path.join(session.dir, 'Untitled.ipynb'),
          filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
        })
        if (canceled || !filePath) return null
        file = filePath.endsWith('.ipynb') ? filePath : `${filePath}.ipynb`
      }
      // A crash or a full disk mid-save leaves the old file, never a truncated one
      await writeFileAtomic(file, ipynbText(notebook))
      app.addRecentDocument(file)
      settings.addRecent(file)
      // Record the save now: the window may close before the renderer reports it
      drafts.update({ path: file, dirty: false, notebook })
      drafts.flush()
      await session.moveWorkspace(path.dirname(file))
      if (allowCloseAfterSave) {
        allowClose = true
        win.close()
      }
      return file
    } finally {
      // Whether the save landed, was cancelled or failed, a later ordinary Save must not close the window
      allowCloseAfterSave = false
    }
  })

  handle(IPC.renameNotebook, async (_e, current: string | null, name: string, notebook: Notebook): Promise<RenameResult> => {
    try {
      if (current !== null) {
        // Only ever a notebook file: the window names what to rename, so any other path is refused
        if (!isNotebookPath(current)) return { error: "Couldn't rename the notebook: that isn't a notebook file." }
        const renamed = await renameNotebookFile(current, name)
        if ('error' in renamed) return renamed
        if (renamed.path !== current) {
          settings.removeRecent(current)
          settings.addRecent(renamed.path)
          app.addRecentDocument(renamed.path)
          // The draft keeps the edits as they are: a rename doesn't save them
          drafts.update({ path: renamed.path, dirty: documentState.dirty, notebook })
          documentState = { ...documentState, path: renamed.path }
          updateTitle()
        }
        return { path: renamed.path, saved: false }
      }
      // A notebook that was never a file is written under its new name, where a new notebook would go.
      // wx: a file that appeared under that name since the check is never overwritten.
      const dir = folderForNewNotebook(session.dir, defaultWorkspace)
      await mkdir(dir, { recursive: true })
      const target = notebookPathIn(dir, name)
      if ('error' in target) return target
      try {
        await writeFile(target.path, ipynbText(notebook), { flag: 'wx' })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { error: `There is already a notebook called "${path.basename(target.path, '.ipynb')}" in this folder.` }
        throw err
      }
      await session.moveWorkspace(dir)
      app.addRecentDocument(target.path)
      settings.addRecent(target.path)
      drafts.update({ path: target.path, dirty: false, notebook })
      drafts.flush()
      return { path: target.path, saved: true }
    } catch (err) {
      return { error: `Couldn't rename the notebook: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` }
    }
  })

  handle(IPC.confirmDiscard, async () => {
    if (!win || !documentState.dirty) return true
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Discard Changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Discard unsaved changes to this notebook?',
    })
    // Keeping the changes also drops a file the OS asked to open, so a later Open shows the dialog
    if (response !== 0) opens.cancel()
    return response === 0
  })

  handle(IPC.restoreSession, async () => {
    const restored = drafts.restore()
    // Nothing to reopen, or a notebook that won't open: the renderer shows the start page, with the reason if any
    if (!restored || !('notebook' in restored)) return restored
    // After a reload nothing is left to receive a running cell's result, so stop it rather than let it run unseen
    if (restored.kernelKept) session.interrupt()
    else if (restored.path) await session.openWorkspace(path.dirname(restored.path))
    return restored
  })
  on(IPC.saveDraft, (_e, state: DraftState) => drafts.update(state))
  // The page subscribed to menu actions, so a queued file can go through its Open
  on(IPC.menuReady, () => opens.setReady(true))

  on(IPC.documentState, (_e, state: { path: string | null; dirty: boolean }) => {
    documentState = state
    updateTitle()
  })

  // Dalliance Cloud. Builds without it answer signed out, with billing unavailable
  handle(IPC.getAccount, () => account?.current ?? SIGNED_OUT)
  handle(IPC.signIn, () => account?.signIn() ?? SIGNED_OUT)
  handle(IPC.redeemSignInCode, (_e, code: string) => (account && typeof code === 'string' ? account.redeem(code) : (account?.current ?? SIGNED_OUT)))
  handle(IPC.signOut, () => account?.signOut() ?? SIGNED_OUT)
  handle(IPC.getBilling, () => billing?.current ?? NO_BILLING)
  handle(IPC.startCheckout, (_e, plan: string) => (billing && plan === 'pro' ? billing.checkout(plan) : (billing?.current ?? NO_BILLING)))
  handle(IPC.openBillingPortal, () => billing?.portal() ?? NO_BILLING)
}

/** Sends account and plan changes to the page, and keeps the plan following the account. */
function watchCloud() {
  if (!account || !billing) return
  const send = (channel: string, view: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, view)
  }
  account.onChange((view) => {
    billing.setSignedIn(view.user != null)
    send(IPC.accountChanged, view)
  })
  billing.onChange((view) => send(IPC.billingChanged, view))
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
    buildMenu(sendMenu)
    createWindow()
    watchCloud()
    session.warmUp()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  app.on('before-quit', () => {
    drafts.flush()
  })

  // Not in before-quit: the close dialog can still cancel the quit, and the notebook would stay open with a dead kernel
  app.on('will-quit', () => {
    drafts.flush()
    billing?.close()
    void session.shutdown()
  })
}
