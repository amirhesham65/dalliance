// Every model call on Dalliance Cloud runs with zero data retention. The proxy sets the gateway's flag on each call,
// whatever the app sent, and only offers models with at least one zero-data-retention provider. See docs/billing.md

/** The gateway's public model list. It says per model whether all, some or none of its providers qualify. */
const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models'
const TTL_MS = 10 * 60_000

let cached: { at: number; ids: ReadonlySet<string> } | null = null

/**
 * The ids of models with a zero-data-retention provider, `zdr` of `all` or `some`. The flag routes a `some` model
 * to its qualifying providers only. Refreshed every ten minutes; a failed refresh keeps the last list, since the
 * flag still holds either way. Null when the list has never loaded.
 */
export async function qualifyingModels(now = Date.now()): Promise<ReadonlySet<string> | null> {
  if (cached && now - cached.at < TTL_MS) return cached.ids
  const res = await fetch(MODELS_URL, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  const body = res?.ok ? ((await res.json().catch(() => null)) as { data?: unknown } | null) : null
  if (!Array.isArray(body?.data)) return cached?.ids ?? null
  const ids = new Set<string>()
  for (const m of body.data as { id?: unknown; zdr?: unknown }[]) {
    // Anything but a known qualifying value counts as not qualifying
    if (typeof m?.id === 'string' && (m.zdr === 'all' || m.zdr === 'some')) ids.add(m.id)
  }
  cached = { at: now, ids }
  return ids
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The call with the gateway's zero-data-retention flag set, overwriting any value the caller sent. */
export function withZeroDataRetention(call: Json): Json {
  const providerOptions = isObject(call.providerOptions) ? call.providerOptions : {}
  const gateway = isObject(providerOptions.gateway) ? providerOptions.gateway : {}
  return { ...call, providerOptions: { ...providerOptions, gateway: { ...gateway, zeroDataRetention: true } } }
}

/** The models a call can reach: the one it names, and any gateway fallbacks, which are ids or `{ model }`. */
export function modelsOf(modelId: string, call: Json): string[] {
  const gateway = isObject(call.providerOptions) ? call.providerOptions.gateway : undefined
  const fallbacks = isObject(gateway) && Array.isArray(gateway.models) ? gateway.models : []
  return [modelId, ...fallbacks.map((f) => (typeof f === 'string' ? f : isObject(f) ? f.model : undefined))].map(String)
}

/** The gateway's `config` model list with only the qualifying models left in it. A list it can't read comes back empty. */
export function filterModelList(config: unknown, allowed: ReadonlySet<string>): Json {
  const models = isObject(config) && Array.isArray(config.models) ? config.models : []
  return { ...(isObject(config) ? config : {}), models: models.filter((m) => isObject(m) && typeof m.id === 'string' && allowed.has(m.id)) }
}
