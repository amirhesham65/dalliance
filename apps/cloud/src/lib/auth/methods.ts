export type SignInMethod = 'google' | 'password'

const KNOWN: SignInMethod[] = ['google', 'password']

/** The sign-in methods this deployment offers. They must match what the Convex deployment has credentials for. */
export function signInMethods(): SignInMethod[] {
  const listed = (process.env.AUTH_METHODS?.trim() || 'google').split(',').map((m) => m.trim())
  return KNOWN.filter((m) => listed.includes(m))
}
