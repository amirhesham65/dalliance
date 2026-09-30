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
function appWindow(url: string) {
  const mainFrame = frame(url)
  const win = { isDestroyed: () => false, webContents: { id: nextId++, mainFrame } }
  return { win, event: { sender: win.webContents, senderFrame: mainFrame } }
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
  it('trusts the top frame of the app window on the app page', () => {
    const { win, event } = appWindow(indexUrl)
    expect(isTrustedSender(event, win, packaged)).toBe(true)
  })

  it('refuses a message from another window', () => {
    const { win } = appWindow(indexUrl)
    const other = appWindow(indexUrl)
    expect(isTrustedSender(other.event, win, packaged)).toBe(false)
  })

  it('refuses a message from an iframe inside the app window', () => {
    const { win } = appWindow(indexUrl)
    const child = frame(indexUrl, { processId: 4, routingId: 7 }, win.webContents.mainFrame)
    expect(isTrustedSender({ sender: win.webContents, senderFrame: child }, win, packaged)).toBe(false)
  })

  it('refuses the app window once it shows some other page', () => {
    const { win, event } = appWindow('https://example.com/')
    expect(isTrustedSender(event, win, packaged)).toBe(false)
  })

  it('refuses when there is no window, it is gone, or the frame is', () => {
    const { win, event } = appWindow(indexUrl)
    expect(isTrustedSender(event, null, packaged)).toBe(false)
    expect(isTrustedSender(event, { ...win, isDestroyed: () => true }, packaged)).toBe(false)
    expect(isTrustedSender({ ...event, senderFrame: null }, win, packaged)).toBe(false)
  })
})
