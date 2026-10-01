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
/** A tab's view. Electron's WebContentsView fits this. */
interface AppView {
  webContents: { id: number; mainFrame: Frame; isDestroyed(): boolean }
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
 * True when an IPC message comes from the top frame of one of the app's tab views, showing the app's own page.
 * Anything else, such as an iframe, another window, or a page a view was somehow navigated to, gets no access to the
 * main process.
 */
export function isTrustedSender(event: SenderEvent, views: readonly AppView[], page: AppPage): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const view = views.find((v) => v.webContents.id === event.sender.id)
  if (!view || view.webContents.isDestroyed()) return false
  const main = view.webContents.mainFrame
  if (frame.parent != null || frame.processId !== main.processId || frame.routingId !== main.routingId) return false
  return isAppUrl(frame.url, page)
}
