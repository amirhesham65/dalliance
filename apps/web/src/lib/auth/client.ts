import { electronProxyClient } from '@better-auth/electron/proxy'
import { createAuthClient } from 'better-auth/react'

/** Must match DESKTOP_SCHEME in the backend and the scheme the desktop app registers. */
export const DESKTOP_SCHEME = 'io.dalliance.app'

// Same origin: /api/auth on this site, which proxies to Convex
export const authClient = createAuthClient({
  plugins: [electronProxyClient({ protocol: { scheme: DESKTOP_SCHEME } })],
})
