import { BrowserWindow } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
import type { AppVerification } from '@dalliance/shared/apps'
import { restrictAppPermissions } from './permissions'
import { redactSecrets } from '../secrets'

/** Runs the page in a separate, sandboxed browser with no preload or Dalliance bridge. */
export async function verifyAppPage(url: string, signal: AbortSignal): Promise<AppVerification> {
  const origin = new URL(url).origin
  const window = new BrowserWindow({
    width: 1100, height: 760, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, partition: `app-check-${crypto.randomUUID()}` },
  })
  const close = () => { if (!window.isDestroyed()) window.destroy() }
  signal.addEventListener('abort', close, { once: true })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (!event.url.startsWith(`${origin}/`)) event.preventDefault()
  })
  restrictAppPermissions(window.webContents.session)
  try {
    signal.throwIfAborted()
    await window.loadURL(`${url}/?embed=true`)
    const started = Date.now()
    while (Date.now() - started < 30_000) {
      signal.throwIfAborted()
      const state: { error: string; ready: boolean; text: string } = await window.webContents.executeJavaScript(`(() => {
        const error = document.querySelector('[data-testid="stException"]');
        const app = document.querySelector('[data-testid="stApp"]');
        const running = app?.getAttribute('data-test-script-state');
        const content = document.querySelector('[data-testid="stAppViewBlockContainer"], [data-testid="stMainBlockContainer"]');
        return { error: error?.textContent?.slice(0, 3000) || '', ready: !!content && running === 'notRunning', text: content?.textContent?.slice(0, 4000) || '' };
      })()`)
      if (state.error) return { ok: false, text: redactSecrets(`App page failed: ${state.error}`) }
      if (state.ready) {
        const image = await window.webContents.capturePage()
        return { ok: true, text: redactSecrets(`App page rendered without startup exceptions. Check the attached screenshot against the prompt.\n${state.text}`), screenshot: image.toPNG() }
      }
      await delay(250, undefined, { signal })
    }
    return { ok: false, text: 'The app page did not finish its first run within 30 seconds. Make startup faster and retry.' }
  } finally {
    signal.removeEventListener('abort', close)
    close()
  }
}
