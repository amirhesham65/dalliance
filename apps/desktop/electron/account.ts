import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { electronClient } from '@better-auth/electron/client'
import { type BetterAuthClientPlugin, createAuthClient } from 'better-auth/client'
import type { BrowserWindow } from 'electron'
import type { AccountView } from '@dalliance/shared/ipc'

/** Must match DESKTOP_SCHEME in packages/backend/convex/auth.ts and apps/web/src/lib/auth/client.ts. */
export const DESKTOP_SCHEME = 'io.dalliance.app'

const DEFAULT_SITE = 'https://dalliance.io'

/** The website that runs sign-in. Development builds can point at a local one with DALLIANCE_SITE_URL. */
export function siteUrl(packaged: boolean) {
  const override = packaged ? undefined : process.env.DALLIANCE_SITE_URL?.trim()
  return (override || DEFAULT_SITE).replace(/\/$/, '')
}

/**
 * A synchronous key-value file for the auth client. The client encrypts every value with safeStorage before it
 * gets here, and keeps the session in memory only when the keychain is unavailable.
 */
function fileStorage(file: string) {
  let data: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    } catch {
      // A corrupt file means signing in again
    }
  }
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: unknown) => {
      data[key] = value
      writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
    },
  }
}

/** What the Electron plugin adds to the client: setupMain, requestAuth, authenticate and getCookie. */
type ElectronActions = ReturnType<ReturnType<typeof electronClient>['getActions']>

function authClient(opts: { userData: string; site: string }) {
  const plugin = electronClient({
    signInURL: `${opts.site}/sign-in`,
    protocol: { scheme: DESKTOP_SCHEME },
    storage: fileStorage(path.join(opts.userData, 'account.json')),
    // Avatars would need their own protocol and a CSP change. The app shows the name and email only
    userImageProxy: { enabled: false },
  })
  // The plugin's fetch types are built against the DOM's RequestInit, which Node's doesn't match, so it goes in
  // untyped and its actions are typed back on
  const client = createAuthClient({ baseURL: `${opts.site}/api/auth`, plugins: [plugin as unknown as BetterAuthClientPlugin] })
  return client as typeof client & ElectronActions
}

function describe(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

/**
 * The Dalliance account, held entirely in the main process. The session cookie never reaches the renderer, which
 * only sees the name and email.
 *
 * Sign-in opens the website in the browser with a PKCE challenge. The site sends the browser back to the app's
 * scheme with a one-time code, and only this process holds the verifier that redeems it.
 */
export class Account {
  private readonly client: ReturnType<typeof authClient>
  private view: AccountView = { user: null, checking: true, waiting: false, error: null }
  private listener: (view: AccountView) => void = () => {}

  constructor(opts: { userData: string; site: string }) {
    this.client = authClient(opts)
  }

  /**
   * Registers the scheme and the deep link handler. Must run before the app is ready. The plugin's own IPC bridges
   * and CSP rewriting stay off: the renderer gets window.dalliance only, and the packaged CSP stays as it is.
   */
  setupMain(getWindow: () => BrowserWindow | null) {
    this.client.setupMain({ scheme: true, bridges: false, csp: false, getWindow })
    // A redeemed code changes the session cookie, which refetches the session and lands here
    this.client.$store.atoms.session?.subscribe((state: { data: { user?: { name: string; email: string } } | null; error: unknown; isPending: boolean }) => {
      if (state.isPending) return
      const status = state.error && typeof state.error === 'object' && 'status' in state.error ? state.error.status : null
      if (state.error && status !== 401) return this.set({ checking: false, error: `Couldn't check your account: ${describe(state.error)}` })
      const user = state.data?.user ? { name: state.data.user.name, email: state.data.user.email } : null
      this.set({ user, checking: false, error: null, waiting: user ? false : this.view.waiting })
    })
  }

  onChange(listener: (view: AccountView) => void) {
    this.listener = listener
  }

  get current(): AccountView {
    return this.view
  }

  private set(patch: Partial<AccountView>) {
    this.view = { ...this.view, ...patch }
    this.listener(this.view)
  }

  /** Asks the server who is signed in. Offline keeps the last known user and says why it couldn't check. */
  async refresh(): Promise<AccountView> {
    try {
      const { data, error } = await this.client.getSession()
      if (error && error.status !== 401) this.set({ checking: false, error: `Couldn't check your account: ${describe(error)}` })
      else this.set({ user: data?.user ? { name: data.user.name, email: data.user.email } : null, checking: false, error: null })
    } catch (err) {
      this.set({ checking: false, error: `Couldn't check your account: ${describe(err)}` })
    }
    return this.view
  }

  /** Opens the sign-in page in the browser. The account updates when the browser hands back. */
  async signIn(): Promise<AccountView> {
    await this.client.requestAuth()
    this.set({ waiting: true, error: null })
    return this.view
  }

  /** Redeems a code copied from the website, for when the browser couldn't open the app. */
  async redeem(code: string): Promise<AccountView> {
    const token = code.trim()
    if (!token) return this.view
    try {
      const result = await this.client.authenticate({ token })
      if (result?.error) this.set({ error: `That code didn't work: ${describe(result.error)}` })
    } catch (err) {
      // The verifier is gone after an app restart, or the code was for another sign-in
      this.set({ error: `That code didn't work: ${describe(err)}. Choose Sign in again for a new one.` })
    }
    return this.refresh()
  }

  async signOut(): Promise<AccountView> {
    try {
      await this.client.signOut()
    } catch {
      // Signed out locally either way. The server session expires on its own
    }
    this.set({ user: null, waiting: false, error: null })
    return this.view
  }
}
