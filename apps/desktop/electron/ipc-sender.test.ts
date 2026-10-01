// @vitest-environment node
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isAppUrl, isTrustedSender } from './ipc-sender'

const indexFile = path.resolve('/Applications/Dalliance.app/Contents/Resources/app.asar/dist/index.html')
const packaged = { indexFile }
const dev = { devServerUrl: 'http://localhost:5173/', indexFile }
const indexUrl = pathToFileURL(indexFile).href

interface Frame {
  url: string
  processId: number
  routingId: number
  parent: Frame | null
}
const frame = (url: string, ids = { processId: 4, routingId: 1 }, parent: Frame | null = null): Frame => ({ url, ...ids, parent })

let nextId = 1
/** A tab's view showing `url`, and a message from its top frame. Each view gets its own renderer process. */
function tabView(url: string) {
  const id = nextId++
  const mainFrame = frame(url, { processId: 100 + id, routingId: 1 })
  let destroyed = false
  const view = { webContents: { id, mainFrame, isDestroyed: () => destroyed } }
  return { view, event: { sender: view.webContents, senderFrame: mainFrame }, destroy: () => (destroyed = true) }
}

describe('isAppUrl', () => {
  it('accepts the packaged index.html, with or without a hash or query', () => {
    expect(isAppUrl(indexUrl, packaged)).toBe(true)
    expect(isAppUrl(`${indexUrl}#settings`, packaged)).toBe(true)
    expect(isAppUrl(`${indexUrl}?welcome`, packaged)).toBe(true)
  })

  it('refuses other files and other schemes when packaged', () => {
    expect(isAppUrl(pathToFileURL(path.resolve('/tmp/evil.html')).href, packaged)).toBe(false)
    expect(isAppUrl('https://example.com/', packaged)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', packaged)).toBe(false)
    expect(isAppUrl('not a url', packaged)).toBe(false)
  })

  it('accepts only the dev server in development', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/src/main.tsx?demo', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
    expect(isAppUrl(indexUrl, dev)).toBe(false)
  })
})

describe('isTrustedSender', () => {
  it('trusts the top frame of each tab view on the app page', () => {
    const tabs = [tabView(indexUrl), tabView(indexUrl), tabView(`${indexUrl}#settings`)]
    const views = tabs.map((t) => t.view)
    for (const t of tabs) expect(isTrustedSender(t.event, views, packaged)).toBe(true)
  })

  it('refuses a message from a view that is not one of the tabs', () => {
    const [a, b] = [tabView(indexUrl), tabView(indexUrl)]
    const other = tabView(indexUrl)
    expect(isTrustedSender(other.event, [a.view, b.view], packaged)).toBe(false)
  })

  it('refuses a frame from one tab sent as another tab', () => {
    const [a, b] = [tabView(indexUrl), tabView(indexUrl)]
    expect(isTrustedSender({ sender: b.view.webContents, senderFrame: a.view.webContents.mainFrame }, [a.view, b.view], packaged)).toBe(false)
  })

  it('refuses a message from an iframe inside a tab', () => {
    const [a, b] = [tabView(indexUrl), tabView(indexUrl)]
    const top = b.view.webContents.mainFrame
    const child = frame(indexUrl, { processId: top.processId, routingId: 7 }, top)
    expect(isTrustedSender({ sender: b.view.webContents, senderFrame: child }, [a.view, b.view], packaged)).toBe(false)
  })

  it('refuses a tab once it shows some other page, and keeps trusting the others', () => {
    const good = tabView(indexUrl)
    const moved = tabView('https://example.com/')
    const views = [good.view, moved.view]
    expect(isTrustedSender(moved.event, views, packaged)).toBe(false)
    expect(isTrustedSender(good.event, views, packaged)).toBe(true)
  })

  it('refuses when there are no tabs, the tab closed, or the frame is gone', () => {
    const t = tabView(indexUrl)
    expect(isTrustedSender(t.event, [], packaged)).toBe(false)
    expect(isTrustedSender({ ...t.event, senderFrame: null }, [t.view], packaged)).toBe(false)
    t.destroy()
    expect(isTrustedSender(t.event, [t.view], packaged)).toBe(false)
  })
})
