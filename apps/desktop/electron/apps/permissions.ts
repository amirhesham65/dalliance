import type { Session, WebContents } from 'electron'

/** App frames have no browser grants. The trusted shell may retain its explicit Copy action. */
export function restrictAppPermissions(session: Session, isShell?: (contents: WebContents | null, url: string) => boolean) {
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    permission === 'clipboard-sanitized-write' && details.isMainFrame && !!isShell?.(contents, details.requestingUrl),
  ))
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === 'clipboard-sanitized-write' && details.isMainFrame && !!isShell?.(contents, details.requestingUrl ?? ''),
  )
  session.setDevicePermissionHandler(() => false)
}
