import { ConvexClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import type { BillingView, PlanOption, SubscriptionView } from '@dalliance/shared/ipc'

// The functions in backend/convex/billing.ts in the dalliance-cloud repo. Called untyped, so the shapes in
// packages/shared/src/ipc.ts have to match what they return
const api = anyApi.billing
// And `usage:credits`, from the same repo, for the credits a run used
const usage = anyApi.usage

function describe(error: unknown) {
  // A ConvexError carries its message in data
  if (error && typeof error === 'object' && 'data' in error && typeof error.data === 'string') return error.data
  return error instanceof Error ? error.message.split('\n')[0] : String(error)
}

const RETRY_MS = 30_000
/** How long to wait for a run's calls to reach the ledger. The service retries a call's cost for 30 seconds. */
const CREDITS_WAIT_MS = 90_000

/**
 * The user's plan, live from Dalliance Cloud's Convex deployment. The main process holds the connection and the
 * account's Convex token; the renderer only gets a BillingView. A payment lands through the billing provider's
 * webhook, and the subscription arrives here without polling.
 */
export class Billing {
  private client: ConvexClient | null = null
  private view: BillingView = { available: true, plans: [], subscription: null, usage: null, loading: true, checkingOut: false, error: null }
  private listener: (view: BillingView) => void = () => {}
  private signedIn = false
  private retry: ReturnType<typeof setTimeout> | null = null
  private readonly opts: {
    /** Where the deployment is. Asked when connecting, so an unreachable service only delays billing. */
    convexUrl: () => Promise<string>
    token: () => Promise<string | null>
    open: (url: string) => Promise<void>
  }

  constructor(opts: Billing['opts']) {
    this.opts = opts
  }

  /** Connects once the deployment's address is known, and keeps trying every 30 seconds until it is. */
  async connect() {
    if (this.client) return
    let url: string
    try {
      url = await this.opts.convexUrl()
    } catch (err) {
      this.set({ loading: false, error: `Couldn't reach Dalliance Cloud: ${describe(err)}` })
      this.retry ??= setTimeout(() => {
        this.retry = null
        void this.connect()
      }, RETRY_MS)
      return
    }
    if (this.client) return
    const client = new ConvexClient(url)
    this.client = client
    this.set({ error: null })
    if (this.signedIn) client.setAuth(() => this.opts.token())
    client.onUpdate(
      api.plans,
      {},
      (plans: PlanOption[]) => this.set({ plans }),
      (err) => this.set({ error: `Couldn't load plans: ${describe(err)}` }),
    )
    client.onUpdate(
      api.status,
      {},
      (status: { subscription: SubscriptionView | null; usage: BillingView['usage'] } | null) => {
        const subscription = status?.subscription ?? null
        this.set({ subscription, usage: status?.usage ?? null, loading: false, error: null, checkingOut: subscription ? false : this.view.checkingOut })
      },
      (err) => this.set({ loading: false, error: `Couldn't check your plan: ${describe(err)}` }),
    )
  }

  onChange(listener: (view: BillingView) => void) {
    this.listener = listener
  }

  get current(): BillingView {
    return this.view
  }

  private set(patch: Partial<BillingView>) {
    this.view = { ...this.view, ...patch }
    this.listener(this.view)
  }

  /** Follows the account. Signed in, queries carry the account's Convex token; signed out, they carry none. */
  setSignedIn(signedIn: boolean) {
    if (signedIn === this.signedIn) return
    this.signedIn = signedIn
    if (!signedIn) this.set({ subscription: null, usage: null, checkingOut: false })
    if (!this.client) return
    if (signedIn) this.client.setAuth(() => this.opts.token())
    else this.client.setAuth(async () => null)
  }

  async checkout(plan: PlanOption['key']): Promise<BillingView> {
    if (!this.client) return this.view
    try {
      const { url } = (await this.client.action(api.checkout, { plan })) as { url: string }
      await this.opts.open(url)
      this.set({ checkingOut: true, error: null })
    } catch (err) {
      this.set({ error: describe(err) })
    }
    return this.view
  }

  async portal(): Promise<BillingView> {
    if (!this.client) return this.view
    try {
      const { url } = (await this.client.action(api.portal, {})) as { url: string }
      await this.opts.open(url)
      this.set({ error: null })
    } catch (err) {
      this.set({ error: describe(err) })
    }
    return this.view
  }

  /**
   * The credits these calls used, for Show costs. The ledger records each call a few seconds after it ends, so this
   * follows `usage:credits` live until every call is there, or CREDITS_WAIT_MS pass, and adds up what came. Null
   * when none did, or signed out. The query only answers for the signed-in user's own calls.
   */
  credits(generationIds: string[], waitMs = CREDITS_WAIT_MS): Promise<number | null> {
    const client = this.client
    const ids = [...new Set(generationIds)]
    if (!client || !this.signedIn || !ids.length) return Promise.resolve(null)
    return new Promise((resolve) => {
      let rows: { generationId: string; credits: number }[] = []
      let settled = false
      let stop: (() => void) | null = null
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stop?.()
        resolve(rows.length ? rows.reduce((sum, r) => sum + r.credits, 0) : null)
      }
      const timer = setTimeout(settle, waitMs)
      const unsubscribe = client.onUpdate(
        usage.credits,
        { generationIds: ids },
        (found: typeof rows | null) => {
          rows = found ?? []
          if (found == null || rows.length >= ids.length) settle()
        },
        () => settle(),
      )
      // The first answer can come before onUpdate returns
      if (settled) unsubscribe()
      else stop = () => unsubscribe()
    })
  }

  close() {
    if (this.retry) clearTimeout(this.retry)
    void this.client?.close()
  }
}
