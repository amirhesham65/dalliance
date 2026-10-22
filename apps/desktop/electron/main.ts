import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, app, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import {
  type AttachResult,
  type CreatedProject,
  type DraftState,
  IPC,
  type MenuAction,
  type OpenedNotebook,
  type RenameResult,
  type RecentNotebook,
  type RunCellRequest,
  type SavedNotebook,
  type SettingsUpdate,
} from '@dalliance/shared/ipc'
import { fromIpynb, pinsFromNb, toIpynb } from '@dalliance/shared/ipynb'
import type { Notebook } from '@dalliance/shared/notebook'
import { writeFileAtomic } from './atomic-write'
import { listModels } from './harness/model'
import { DraftStore } from './draft'
import { prepareImage } from './images'
import { type AppPage, isTrustedSender } from './ipc-sender'
import { buildMenu } from './menu'
import { folderForNewNotebook, newNotebookPath, notebookInProject, notebookPathIn, projectPathIn, renameNotebookFile } from './notebook-files'
import { isBroadFolder } from './harness/workspace'
import { OpenQueue, notebookFromArgv } from './open-files'
import { NotebookSession } from './session'
import { SettingsStore } from './settings'
import { ProviderKeys } from './provider-keys'
import { Updates } from './updates'
import { copyIntoUploads } from './uploads'

const isMac = process.platform === 'darwin'
const TITLE_BAR_HEIGHT = 48

// One copy of the app at a time. A second launch hands its command line to this one through 'second-instance'
// and exits at once, before it reads settings.
const primary = app.requestSingleInstanceLock()
if (!primary) app.exit(0)

let win: BrowserWindow | null = null
let documentState = { path: null as string | null, dirty: false }
let allowClose = false
// Set when the close dialog chose Save: once the save lands, the window closes
let allowCloseAfterSave = false

const keys = new ProviderKeys(app.getPath('userData'), {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (value) => safeStorage.decryptString(value),
})
const settings = new SettingsStore(app.getPath('userData'), keys.get)
const drafts = new DraftStore(app.getPath('userData'))
// Newer releases, offered as a download. See docs/releasing.md
const updates = new Updates({ version: app.getVersion(), open: (url) => shell.openExternal(url) })
// Unsaved notebooks run in their own folder, never in all of Documents
const defaultWorkspace = path.join(app.getPath('documents'), 'Dalliance Notebooks')
mkdirSync(defaultWorkspace, { recursive: true })

const session = new NotebookSession({
  settings,
  userData: app.getPath('userData'),
  defaultWorkspace,
  send: (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  },
  prepareImage,
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
 * Write a notebook under the first free `name` in `dir`: "Untitled", then "Untitled 2". The `wx` flag never overwrites
 * a file that appeared after the name was picked: that name is skipped and the next free one tried.
 */
async function writeNewNotebook(dir: string, notebook: Notebook, name?: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const file = newNotebookPath(dir, name)
    try {
      await writeFile(file, ipynbText(notebook), { flag: 'wx' })
      return file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 4) throw err
    }
  }
}

/** Write a new notebook into `dir` and open it there on a fresh kernel. Throws when the folder can't be written to. */
async function startNotebook(dir: string, notebook: Notebook, name?: string): Promise<OpenedNotebook> {
  // The folder may have been moved or deleted since it was chosen
  await mkdir(dir, { recursive: true })
  const file = await writeNewNotebook(dir, notebook, name)
  await session.openWorkspace(dir)
  // Only once the notebook is really open, so a failure above leaves no recent entry behind
  app.addRecentDocument(file)
  settings.addRecent(file)
  drafts.update({ path: file, dirty: false, notebook })
  return { path: file, notebook }
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message.split('\n')[0] : String(err))

/**
 * A new notebook is a file from the start, in the folder it was made for, with a fresh kernel there. When the folder
 * can't be written to, the reason is shown in a dialog and the result is null, so the window stays as it was.
 */
async function createNotebook(dir: string, notebook: Notebook): Promise<OpenedNotebook | null> {
  try {
    return await startNotebook(dir, notebook)
  } catch (err) {
    if (win) await dialog.showMessageBox(win, { type: 'error', message: "Couldn't create a notebook here", detail: `${dir}\n${firstLine(err)}` })
    return null
  }
}

/** Where new projects go: the folder chosen for them, or the default one when none was or it has gone. */
const projectsFolder = () => settings.projectsDir ?? defaultWorkspace

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
  handle(IPC.getSettings, () => settings.view())
  handle(IPC.listModels, () => listModels(keys.get))
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

  handle(IPC.projectsFolder, () => projectsFolder())

  handle(IPC.chooseProjectsFolder, async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose where new projects go',
      buttonLabel: 'Choose',
      defaultPath: projectsFolder(),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || !filePaths[0]) return null
    settings.setProjectsDir(filePaths[0])
    return filePaths[0]
  })

  // A project is a folder of its own. Its first notebook takes the project's name.
  handle(IPC.createProject, async (_e, name: string, notebook: Notebook): Promise<CreatedProject> => {
    const target = projectPathIn(projectsFolder(), typeof name === 'string' ? name : '')
    if ('error' in target) return target
    try {
      await mkdir(projectsFolder(), { recursive: true })
      // Not recursive: a folder that appeared under that name since the check is never taken over
      await mkdir(target.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { error: `There is already a folder called "${target.name}" there.` }
      return { error: `Couldn't create the project: ${firstLine(err)}` }
    }
    try {
      return await startNotebook(target.path, notebook, target.name)
    } catch (err) {
      // Leave nothing behind but what was there. rmdir only removes an empty folder.
      await rmdir(target.path).catch(() => {})
      return { error: `Couldn't create the project: ${firstLine(err)}` }
    }
  })

  handle(IPC.openProject, async (_e, notebook: Notebook) => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open project',
      buttonLabel: 'Open',
      defaultPath: projectsFolder(),
      properties: ['openDirectory'],
    })
    const dir = filePaths[0]
    if (canceled || !dir) return null
    // The agent can't list a folder like Documents, so it makes a poor project
    if (isBroadFolder(dir)) {
      await dialog.showMessageBox(win, {
        type: 'info',
        message: `${path.basename(dir) || dir} is too broad to be a project`,
        detail: 'Choose the folder that holds your notebooks and data, or start a new project.',
      })
      return null
    }
    try {
      const file = await notebookInProject(dir, settings.recent)
      return file ? await openFile(file) : await startNotebook(dir, notebook)
    } catch (err) {
      await dialog.showMessageBox(win, { type: 'error', message: "Couldn't open the project", detail: `${dir}\n${firstLine(err)}` })
      return null
    }
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
  // The paths come from the preload, which reads them off File objects from a real drop. The window can't name one.
  handle(IPC.attachFiles, async (_e, sources: unknown): Promise<AttachResult> => {
    if (!Array.isArray(sources) || !sources.every((s) => typeof s === 'string')) return { paths: [], error: "Couldn't attach those files." }
    // The agent can't list a folder like Documents, so files dropped there would be lost on it
    if (isBroadFolder(session.dir)) return { paths: [], error: 'Files can only be attached in a project. Create or open one first.' }
    return copyIntoUploads(session.dir, sources)
  })
  // Always the folder in use, never a path from the window
  handle(IPC.revealFolder, async () => {
    const failed = await shell.openPath(session.dir)
    if (failed) throw new Error(failed)
  })

  handle(IPC.saveNotebook, async (_e, current: string | null, unpinned: Notebook): Promise<SavedNotebook | null> => {
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
      // The Python, packages and data files the cells ran with. See docs/notebook-model.md#pins
      const notebook = await session.pin(unpinned)
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
      return { path: file, pins: notebook.pins ?? null }
    } finally {
      // Whether the save landed, was cancelled or failed, a later ordinary Save must not close the window
      allowCloseAfterSave = false
    }
  })

  handle(IPC.renameNotebook, async (_e, current: string | null, name: string, unpinned: Notebook): Promise<RenameResult> => {
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
          drafts.update({ path: renamed.path, dirty: documentState.dirty, notebook: unpinned })
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
      // Writing the file is a save, so it records the pins too
      const notebook = await session.pin(unpinned)
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
      return { path: target.path, saved: true, pins: notebook.pins ?? null }
    } catch (err) {
      return { error: `Couldn't rename the notebook: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` }
    }
  })

  handle(IPC.checkPins, (_e, pins: unknown) => {
    // Pins come from the file, so they're checked like the file is. Paths outside the folder are never read
    const checked = pinsFromNb(pins)
    return checked ? session.checkPins(checked) : []
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

  handle(IPC.getProviderKeys, () => keys.view())
  handle(IPC.setProviderKey, (_e, provider: unknown, key: unknown) => keys.set(provider, key))

  handle(IPC.getUpdate, () => updates.current)
  handle(IPC.downloadUpdate, () => updates.download())
}

/** Sends a newer release to the page. Only a packaged build checks: in development the version means nothing. */
function watchUpdates() {
  updates.onChange((update) => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.updateFound, update)
  })
  if (app.isPackaged) updates.start()
}

if (primary) {
  // macOS sends files from Finder and the Dock here, at launch before 'ready' too, so this is registered early
  app.on('open-file', (event, file) => {
    event.preventDefault()
    if (isNotebookPath(file)) openFromOs(file)
  })
  // A second launch, with or without a file. Windows and Linux pass a double-clicked file on the command line,
  app.on('second-instance', (_event, argv, workingDirectory) => {
    openFromOs(notebookFromArgv(argv, workingDirectory))
  })
  const launchFile = notebookFromArgv(process.argv, process.cwd())
  if (launchFile) opens.request(launchFile)

  void app.whenReady().then(() => {
    registerIpc()
    buildMenu(sendMenu)
    createWindow()
    watchUpdates()
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
    updates.stop()
    void session.shutdown()
  })
}
