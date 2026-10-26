import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type DallianceApi } from '@dalliance/shared/ipc'

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void) {
  const handler = (_event: unknown, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// The renderer gets this typed surface only, never ipcRenderer itself
const api: DallianceApi = {
  platform: process.platform,
  runCell: (request) => ipcRenderer.invoke(IPC.runCell, request),
  onRunEvent: (listener) => subscribe(IPC.runEvent, listener),
  respond: (requestId, answer) => ipcRenderer.send(IPC.respond, requestId, answer),
  interrupt: () => ipcRenderer.invoke(IPC.interrupt),
  restartKernel: () => ipcRenderer.invoke(IPC.restartKernel),
  kernelState: () => ipcRenderer.invoke(IPC.kernelState),
  listVariables: () => ipcRenderer.invoke(IPC.listVariables),
  listPackages: () => ipcRenderer.invoke(IPC.listPackages),
  onKernelState: (listener) => subscribe(IPC.kernelStateChanged, listener),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  updateSettings: (update) => ipcRenderer.invoke(IPC.updateSettings, update),
  pythonState: () => ipcRenderer.invoke(IPC.pythonState),
  setupPython: () => ipcRenderer.invoke(IPC.setupPython),
  onPythonLog: (listener) => subscribe(IPC.pythonLog, listener),
  openNotebook: () => ipcRenderer.invoke(IPC.openNotebook),
  newNotebook: (notebook) => ipcRenderer.invoke(IPC.newNotebook, notebook),
  createProject: (name, notebook) => ipcRenderer.invoke(IPC.createProject, name, notebook),
  openProject: (notebook) => ipcRenderer.invoke(IPC.openProject, notebook),
  projectsFolder: () => ipcRenderer.invoke(IPC.projectsFolder),
  chooseProjectsFolder: () => ipcRenderer.invoke(IPC.chooseProjectsFolder),
  openRecent: (path) => ipcRenderer.invoke(IPC.openRecent, path),
  recentNotebooks: () => ipcRenderer.invoke(IPC.recentNotebooks),
  readBrief: () => ipcRenderer.invoke(IPC.readBrief),
  writeBrief: (text) => ipcRenderer.invoke(IPC.writeBrief, text),
  listFiles: (directory) => ipcRenderer.invoke(IPC.listFiles, directory),
  revealFolder: () => ipcRenderer.invoke(IPC.revealFolder),
  revealFile: (file) => ipcRenderer.invoke(IPC.revealFile, file),
  // Only a File from a real drop has a path. Anything else reads as '' and is left out
  attachFiles: (files) => ipcRenderer.invoke(IPC.attachFiles, files.map((f) => webUtils.getPathForFile(f as File)).filter(Boolean)),
  renameNotebook: (current, name, notebook) => ipcRenderer.invoke(IPC.renameNotebook, current, name, notebook),
  saveNotebook: (path, notebook, options) => ipcRenderer.invoke(IPC.saveNotebook, path, notebook, options),
  checkPins: (pins) => ipcRenderer.invoke(IPC.checkPins, pins),
  confirmDiscard: () => ipcRenderer.invoke(IPC.confirmDiscard),
  restoreSession: () => ipcRenderer.invoke(IPC.restoreSession),
  saveDraft: (state) => ipcRenderer.send(IPC.saveDraft, state),
  setDocumentState: (state) => ipcRenderer.send(IPC.documentState, state),
  onMenu: (listener) => {
    const off = subscribe(IPC.menu, listener)
    // Now a menu action can land, the main process may send one it held back, like opening a file from Finder
    ipcRenderer.send(IPC.menuReady)
    return off
  },
  getProviderKeys: () => ipcRenderer.invoke(IPC.getProviderKeys),
  setProviderKey: (provider, key) => ipcRenderer.invoke(IPC.setProviderKey, provider, key),
  getUpdate: () => ipcRenderer.invoke(IPC.getUpdate),
  downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate),
  onUpdate: (listener) => subscribe(IPC.updateFound, listener),
}

contextBridge.exposeInMainWorld('dalliance', api)
