import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

// Convex trusts the JWTs the Better Auth convex plugin signs, checked against its JWKS
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
