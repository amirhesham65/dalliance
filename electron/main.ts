import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { IPC, type MenuAction, type RunCellRequest, type SettingsUpdate } from '../src/shared/ipc'
import { fromIpynb, toIpynb } from '../src/shared/ipynb'
import type { Notebook } from '../src/shared/notebook'
import { buildMenu } from './menu'
import { NotebookSession } from './session'
import { SettingsStore } from './settings'

const isMac = process.platform === 'darwin'
const TITLE_BAR_HEIGHT = 48

// In development, read keys from .env in the project folder
const envFile = path.join(app.getAppPath(), '.env')
if (!app.isPackaged && existsSync(envFile)) process.loadEnvFile(envFile)

let win: BrowserWindow | null = null
let documentState = { path: null as string | null, dirty: false }
let allowClose = false
// Set when the close dialog chose Save: once the save lands, the window closes
let allowCloseAfterSave = false

const settings = new SettingsStore(app.getPath('userData'))
// Unsaved notebooks run in their own folder, never in all of Documents
const defaultWorkspace = path.join(app.getPath('documents'), 'Ilios Notebooks')
mkdirSync(defaultWorkspace, { recursive: true })
const session = new NotebookSession({
  settings,
  userData: app.getPath('userData'),
  defaultWorkspace,
  send: (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  },
})

const sendMenu = (action: MenuAction) => win?.webContents.send(IPC.menu, action)

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Ilios',
    backgroundColor: '#161616',
    show: false,
    // The renderer draws its own top bar. macOS keeps native traffic lights,
    // Windows and Linux get native window controls drawn over the bar.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#161616', symbolColor: '#9e9e9e', height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())

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
      allowClose = true
      win.close()
    }
  })
  win.on('closed', () => {
    win = null
  })

  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void win.loadFile(path.join(import.meta.dirname, '../dist/index.html'))
}

function updateTitle() {
  if (!win) return
  const name = documentState.path ? path.basename(documentState.path) : 'Untitled'
  win.setTitle(`${name}${documentState.dirty ? ' (edited)' : ''} · Ilios`)
  if (isMac) {
    win.setRepresentedFilename(documentState.path ?? '')
    win.setDocumentEdited(documentState.dirty)
  }
}

function registerIpc() {
  ipcMain.handle(IPC.runCell, (event, request: RunCellRequest) => session.runCell(request, event.sender))
  ipcMain.on(IPC.respond, (_e, requestId: string, answer: string | boolean | null) => session.respond(requestId, answer))
  ipcMain.handle(IPC.interrupt, () => session.interrupt())
  ipcMain.handle(IPC.restartKernel, () => session.restart())
  ipcMain.handle(IPC.kernelState, () => session.kernelState())
  ipcMain.handle(IPC.listVariables, () => session.variables())
  ipcMain.handle(IPC.getSettings, () => settings.view())
  ipcMain.handle(IPC.updateSettings, async (_e, update: SettingsUpdate) => {
    const pythonChanged = update.pythonPath !== undefined && update.pythonPath !== settings.pythonPath
    const view = settings.update(update)
    if (pythonChanged) await session.restart()
    return view
  })
  ipcMain.handle(IPC.pythonState, () => session.pythonState())
  ipcMain.handle(IPC.setupPython, () => session.setupPython())

  ipcMain.handle(IPC.openNotebook, async () => {
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open notebook',
      filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    const file = filePaths[0]
    const notebook = fromIpynb(JSON.parse(await readFile(file, 'utf-8')))
    app.addRecentDocument(file)
    await session.openWorkspace(path.dirname(file))
    return { path: file, notebook }
  })

  ipcMain.handle(IPC.saveNotebook, async (_e, current: string | null, notebook: Notebook) => {
    if (!win) return null
    let file = current
    if (!file) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save notebook',
        defaultPath: path.join(defaultWorkspace, 'Untitled.ipynb'),
        filters: [{ name: 'Notebooks', extensions: ['ipynb'] }],
      })
      if (canceled || !filePath) {
        allowCloseAfterSave = false
        return null
      }
      file = filePath.endsWith('.ipynb') ? filePath : `${filePath}.ipynb`
    }
    await writeFile(file, `${JSON.stringify(toIpynb(notebook), null, 1)}\n`)
    app.addRecentDocument(file)
    await session.moveWorkspace(path.dirname(file))
    if (allowCloseAfterSave) {
      allowClose = true
      win.close()
    }
    return file
  })

  ipcMain.handle(IPC.confirmDiscard, async () => {
    if (!win || !documentState.dirty) return true
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Discard Changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Discard unsaved changes to this notebook?',
    })
    return response === 0
  })

  ipcMain.on(IPC.documentState, (_e, state: { path: string | null; dirty: boolean }) => {
    documentState = state
    updateTitle()
  })
}

void app.whenReady().then(() => {
  registerIpc()
  buildMenu(sendMenu)
  createWindow()
  session.warmUp()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('before-quit', () => {
  void session.shutdown()
})
