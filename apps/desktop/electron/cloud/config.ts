import { DESKTOP_SCHEME, SIGN_IN_CALLBACK } from '@dalliance/shared/cloud'

/** Dalliance Cloud: the account, the plan and the models. See docs/cloud.md. */
const PRODUCTION = 'https://cloud.dalliance.io'

/** Dalliance Cloud's origin. Development builds can point at a local copy of the service with DALLIANCE_CLOUD_URL. */
export function cloudUrl(packaged: boolean): string {
  const override = packaged ? undefined : process.env.DALLIANCE_CLOUD_URL?.trim()
  return (override || PRODUCTION).replace(/\/$/, '')
}

/** What the service tells the app about itself, from /api/config. */
export interface CloudConfig {
  /** The Convex deployment's .convex.cloud URL, which the plan comes from. */
  convexUrl: string
}

/**
 * Asks the service where its backend is, so the Cloud URL is the only thing a build has to know. Rejects when
 * the service can't be reached or answers something else, and the caller tries again later.
 */
export async function fetchCloudConfig(cloud: string): Promise<CloudConfig> {
  const res = await fetch(`${cloud}/api/config`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Dalliance Cloud answered ${res.status}`)
  const body = (await res.json()) as Partial<CloudConfig>
  if (typeof body.convexUrl !== 'string' || !body.convexUrl.startsWith('https://')) throw new Error("Dalliance Cloud didn't say where its backend is")
  return { convexUrl: body.convexUrl }
}

/** The one-time sign-in code in a link like `io.dalliance.app://auth/callback#token=…`, or null for any other link. */
export function signInCode(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  // The plugin reads the host as the first path segment, so only this exact form counts
  if (`${url.protocol}//${url.hostname}${url.pathname}` !== SIGN_IN_CALLBACK) return null
  const code = url.hash.startsWith('#token=') ? url.hash.slice(7) : ''
  return code || null
}

/** A link on the app's scheme in a command line. Windows and Linux pass deep links to a second launch this way. */
export function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DESKTOP_SCHEME}:`)) ?? null
}
