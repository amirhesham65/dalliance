import { pathToFileURL } from 'node:url'

/** Where the app's own page comes from: the Vite dev server in development, the packaged index.html otherwise. */
export interface AppPage {
  devServerUrl?: string
  indexFile: string
}

/** The parts of an IPC event and a frame the check reads. Electron's own types fit these. */
interface Frame {
  url: string
  processId: number
  routingId: number
  parent: Frame | null
}
interface SenderEvent {
  sender: { id: number }
  senderFrame: Frame | null
}
interface AppWindow {
  isDestroyed(): boolean
  webContents: { id: number; mainFrame: Frame }
}

/** True when `url` is the app's own page. Query strings and hashes don't matter. */
export function isAppUrl(url: string, page: AppPage): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (page.devServerUrl) {
    try {
      return parsed.origin === new URL(page.devServerUrl).origin
    } catch {
      return false
    }
  }
  return parsed.protocol === 'file:' && parsed.pathname === pathToFileURL(page.indexFile).pathname
}

/**
 * True when an IPC message comes from the top frame of the app's window, showing the app's own page. Anything else,
 * such as an iframe, another window, or a page the window was somehow navigated to, gets no access to the main process.
 */
export function isTrustedSender(event: SenderEvent, win: AppWindow | null, page: AppPage): boolean {
  const frame = event.senderFrame
  if (!win || win.isDestroyed() || !frame) return false
  if (event.sender.id !== win.webContents.id) return false
  const main = win.webContents.mainFrame
  if (frame.parent != null || frame.processId !== main.processId || frame.routingId !== main.routingId) return false
  return isAppUrl(frame.url, page)
}
