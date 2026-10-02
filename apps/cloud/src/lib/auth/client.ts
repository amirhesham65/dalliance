import { electronProxyClient } from '@better-auth/electron/proxy'
import { DESKTOP_SCHEME } from '@dalliance/shared/cloud'
import { createAuthClient } from 'better-auth/react'

// Same origin: /api/auth on this site, which proxies to Convex
export const authClient = createAuthClient({
  plugins: [electronProxyClient({ protocol: { scheme: DESKTOP_SCHEME } })],
})
