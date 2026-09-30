import type { ApprovalRequest } from './events'

/**
 * Approval config as data, not code (course module 2): the same gate behaves differently
 * when a person is at the keyboard, when running unattended, or when trust is delegated.
 */
export type ApprovalConfig =
  | { mode: 'interactive' }
  | { mode: 'background' }
  | { mode: 'delegated'; trust: string[] }

/**
 * Returns a function that answers "does allowing these keys need a person to approve?". A key is a package name
 * for an install, or `code:shell` and `code:network` for code that runs commands or uses the network.
 */
export function createApproval(config: ApprovalConfig, sessionTrust: Set<string> = new Set()) {
  return (keys: string[]): boolean => {
    if (config.mode === 'background') return false
    const trusted = config.mode === 'delegated' ? new Set([...config.trust, ...sessionTrust]) : sessionTrust
    return keys.some((k) => !trusted.has(normalize(k)))
  }
}

/**
 * The one approval flow, for installs and for code alike: the policy decides whether to ask, and a person answers
 * when it does. Resolves true when allowed.
 */
export function approver(needsApproval: (keys: string[]) => boolean, requestApproval: (title: string, detail: string, keys: string[]) => Promise<boolean>) {
  return async ({ title, detail, keys }: ApprovalRequest): Promise<boolean> => !needsApproval(keys) || requestApproval(title, detail, keys)
}

export function normalize(pkg: string): string {
  return pkg.trim().toLowerCase().split(/[<>=!~[]/)[0]
}
