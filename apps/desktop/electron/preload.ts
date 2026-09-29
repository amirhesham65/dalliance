import { contextBridge, ipcRenderer } from 'electron'
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
  onKernelState: (listener) => subscribe(IPC.kernelStateChanged, listener),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  checkKey: (provider, key) => ipcRenderer.invoke(IPC.checkKey, provider, key),
  updateSettings: (update) => ipcRenderer.invoke(IPC.updateSettings, update),
  pythonState: () => ipcRenderer.invoke(IPC.pythonState),
  setupPython: () => ipcRenderer.invoke(IPC.setupPython),
  onPythonLog: (listener) => subscribe(IPC.pythonLog, listener),
  openNotebook: () => ipcRenderer.invoke(IPC.openNotebook),
  newNotebook: (notebook) => ipcRenderer.invoke(IPC.newNotebook, notebook),
  openFolder: (notebook) => ipcRenderer.invoke(IPC.openFolder, notebook),
  openRecent: (path) => ipcRenderer.invoke(IPC.openRecent, path),
  recentNotebooks: () => ipcRenderer.invoke(IPC.recentNotebooks),
  readBrief: () => ipcRenderer.invoke(IPC.readBrief),
  writeBrief: (text) => ipcRenderer.invoke(IPC.writeBrief, text),
  listFiles: () => ipcRenderer.invoke(IPC.listFiles),
  renameNotebook: (current, name, notebook) => ipcRenderer.invoke(IPC.renameNotebook, current, name, notebook),
  saveNotebook: (path, notebook) => ipcRenderer.invoke(IPC.saveNotebook, path, notebook),
  confirmDiscard: () => ipcRenderer.invoke(IPC.confirmDiscard),
  restoreSession: () => ipcRenderer.invoke(IPC.restoreSession),
  saveDraft: (state) => ipcRenderer.send(IPC.saveDraft, state),
  setDocumentState: (state) => ipcRenderer.send(IPC.documentState, state),
  onMenu: (listener) => subscribe(IPC.menu, listener),
  getAccount: () => ipcRenderer.invoke(IPC.getAccount),
  signIn: () => ipcRenderer.invoke(IPC.signIn),
  redeemSignInCode: (code) => ipcRenderer.invoke(IPC.redeemSignInCode, code),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
  onAccount: (listener) => subscribe(IPC.accountChanged, listener),
}

contextBridge.exposeInMainWorld('dalliance', api)
