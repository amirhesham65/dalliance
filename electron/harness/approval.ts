/**
 * Approval config as data, not code (course module 2): the same gate behaves differently
 * when a person is at the keyboard, when running unattended, or when trust is delegated.
 */
export type ApprovalConfig =
  | { mode: 'interactive' }
  | { mode: 'background' }
  | { mode: 'delegated'; trust: string[] }

/** Returns a function that answers "does installing these packages need a person to approve?" */
export function createApproval(config: ApprovalConfig, sessionTrust: Set<string> = new Set()) {
  return (packages: string[]): boolean => {
    if (config.mode === 'background') return false
    const trusted = config.mode === 'delegated' ? new Set([...config.trust, ...sessionTrust]) : sessionTrust
    return packages.some((p) => !trusted.has(normalize(p)))
  }
}

export function normalize(pkg: string): string {
  return pkg.trim().toLowerCase().split(/[<>=!~[]/)[0]
}
