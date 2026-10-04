import 'server-only'
import { type Metrics, type MetricsRange, metricsApi } from '@dalliance/shared/metrics'
import { ConvexHttpClient } from 'convex/browser'

const env = (name: string) => process.env[name]?.trim() || undefined

/** The deployment's name, like "happy-otter-123", so the page says which one it's showing. */
export function deploymentName() {
  const url = env('CONVEX_URL')
  if (!url) return null
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return url
  }
}

export type MetricsResult = { ok: true; metrics: Metrics } | { ok: false; missing: string[] } | { ok: false; error: string }

/**
 * Runs the backend's internal `metrics:overview` with the deploy key, on the server only. The key never reaches
 * the browser: this module is server-only and the page renders on the server.
 */
export async function readMetrics(days: MetricsRange): Promise<MetricsResult> {
  const url = env('CONVEX_URL')
  const key = env('CONVEX_DEPLOY_KEY')
  const missing = [!url && 'CONVEX_URL', !key && 'CONVEX_DEPLOY_KEY'].filter((name): name is string => Boolean(name))
  if (!url || !key) return { ok: false, missing }
  const client = new ConvexHttpClient(url)
  // Public in the client, left out of its types. Internal functions need an admin key, which a deploy key is
  ;(client as unknown as { setAdminAuth: (token: string) => void }).setAdminAuth(key)
  try {
    return { ok: true, metrics: await client.query(metricsApi.overview, { days }) }
  } catch (err) {
    // Convex's own message, like a missing function before the backend is deployed. It never carries the key
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
