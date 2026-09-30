import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { electronClient } from '@better-auth/electron/client'
import { type BetterAuthClientPlugin, createAuthClient } from 'better-auth/client'
import type { BrowserWindow } from 'electron'
import type { AccountView } from '@dalliance/shared/ipc'
import { writeFileAtomicSync } from '../atomic-write'
import { DESKTOP_SCHEME, signInCode } from './config'

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
      writeFileAtomicSync(file, JSON.stringify(data), { mode: 0o600 })
    },
  }
}

/** What the Electron plugin adds to the client: setupMain, requestAuth, authenticate and getCookie. */
type ElectronActions = ReturnType<ReturnType<typeof electronClient>['getActions']>

function authClient(opts: { userData: string; cloud: string }) {
  const plugin = electronClient({
    signInURL: `${opts.cloud}/sign-in`,
    protocol: { scheme: DESKTOP_SCHEME },
    storage: fileStorage(path.join(opts.userData, 'account.json')),
    // Avatars would need their own protocol and a CSP change. The app shows the name and email only
    userImageProxy: { enabled: false },
  })
  // The plugin's fetch types are built against the DOM's RequestInit, which Node's doesn't match, so it goes in
  // untyped and its actions are typed back on
  const client = createAuthClient({ baseURL: `${opts.cloud}/api/auth`, plugins: [plugin as unknown as BetterAuthClientPlugin] })
  return client as typeof client & ElectronActions
}

/** When a JWT expires, in ms, from its `exp` claim. The server checks the token; this only decides when to fetch another. */
function expiry(jwt: string) {
  try {
    const { exp } = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number }
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch {
    return 0
  }
}

/** An error's message, without a closing period, so it can sit mid-sentence. */
function describe(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message ? error.message : String(error)
  return message.replace(/\.+$/, '')
}

type SessionState = { data: { user?: { name: string; email: string } } | null; error: unknown; isPending: boolean }

/**
 * The Dalliance account, held entirely in the main process. The session cookie never reaches the renderer, which
 * only sees the name and email.
 *
 * Sign-in opens Dalliance Cloud's sign-in page in the browser with a PKCE challenge. The page sends the browser
 * back to the app's scheme with a one-time code, and only this process holds the verifier that redeems it.
 */
export class Account {
  private readonly client: ReturnType<typeof authClient>
  private view: AccountView = { user: null, checking: true, waiting: false, error: null }
  private listener: (view: AccountView) => void = () => {}
  /** The last Convex token and when it expires, in ms. Each model call needs one, so it's reused until near the end. */
  private token: { value: string; expires: number } | null = null
  private fetching: Promise<string | null> | null = null

  constructor(opts: { userData: string; cloud: string; getWindow: () => BrowserWindow | null }) {
    this.client = authClient(opts)
    // The scheme, the single-instance lock and deep links are main.ts's: it already owns 'second-instance' and
    // 'open-url', and hands sign-in links to handleLink. The plugin's IPC bridges and CSP rewriting stay off too:
    // the renderer gets window.dalliance only, and the packaged CSP stays as it is
    this.client.setupMain({ scheme: false, bridges: false, csp: false, getWindow: opts.getWindow })
    // A redeemed code changes the session cookie, which refetches the session and lands here
    this.client.$store.atoms.session?.subscribe((state: SessionState) => {
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

  get signedIn() {
    return this.view.user != null
  }

  private set(patch: Partial<AccountView>) {
    // Another user, or none, means the cached token isn't theirs
    if ('user' in patch && patch.user?.email !== this.view.user?.email) this.token = null
    this.view = { ...this.view, ...patch }
    this.listener(this.view)
  }

  /** Asks the service who is signed in. Offline keeps the last known user and says why it couldn't check. */
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

  /**
   * A short-lived JWT that Convex accepts for this user, fetched with the session cookie. It stays in the main
   * process like the session. Null when signed out or offline.
   */
  async convexToken(): Promise<string | null> {
    if (!this.view.user) return null
    if (this.token && this.token.expires - Date.now() > 60_000) return this.token.value
    // Concurrent callers, like a cell and its title, share one fetch
    this.fetching ??= this.fetchToken().finally(() => {
      this.fetching = null
    })
    return this.fetching
  }

  private async fetchToken(): Promise<string | null> {
    try {
      const { data } = await this.client.$fetch<{ token?: string }>('/convex/token', { method: 'GET' })
      const value = data?.token ?? null
      this.token = value ? { value, expires: expiry(value) } : null
      return value
    } catch {
      return null
    }
  }

  /** Opens the sign-in page in the browser. The account updates when the browser hands back. */
  async signIn(): Promise<AccountView> {
    await this.client.requestAuth()
    this.set({ waiting: true, error: null })
    return this.view
  }

  /**
   * A link on the app's scheme, from the OS. A sign-in link carries a one-time code, which only redeems with the
   * verifier from this app's own pending sign-in, so a link from any other page does nothing. With no sign-in
   * pending it isn't even tried, so such a page can't put an error in Settings either. Other links are ignored.
   */
  handleLink(link: string) {
    const code = signInCode(link)
    if (code && this.view.waiting) void this.redeem(code)
  }

  /** Redeems a sign-in code, from a link or pasted from the sign-in page when the browser couldn't open the app. */
  async redeem(code: string): Promise<AccountView> {
    const token = code.trim()
    if (!token) return this.view
    // A failure returns without refreshing, which would clear the message
    try {
      const result = await this.client.authenticate({ token })
      if (result?.error) {
        this.set({ error: `That code didn't work: ${describe(result.error)}` })
        return this.view
      }
    } catch (err) {
      // The verifier is gone after an app restart, or the code was for another sign-in
      this.set({ error: `That code didn't work: ${describe(err)}. Choose Sign in again for a new one.` })
      return this.view
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
