// @vitest-environment node
import type { Session } from 'electron'
import { expect, it, vi } from 'vitest'
import { restrictAppPermissions } from './permissions'
it('denies permission checks, requests and device access in app sessions', () => {
  const session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn() }
  restrictAppPermissions(session as unknown as Session)
  const respond = vi.fn()
  session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', respond)
  expect(respond).toHaveBeenCalledWith(false)
  expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
  expect(session.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)
})

it('allows only clipboard writes from the trusted shell, with no grant for an app subframe', () => {
  const session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn() }
  restrictAppPermissions(session as unknown as Session, (_contents, url) => url === 'file:///app/index.html')
  const request = session.setPermissionRequestHandler.mock.calls[0][0]
  const callback = vi.fn()
  request(null, 'clipboard-sanitized-write', callback, { isMainFrame: true, requestingUrl: 'file:///app/index.html' })
  expect(callback).toHaveBeenLastCalledWith(true)
  request(null, 'clipboard-sanitized-write', callback, { isMainFrame: false, requestingUrl: 'http://127.0.0.1:8501' })
  expect(callback).toHaveBeenLastCalledWith(false)
  request(null, 'media', callback, { isMainFrame: true, requestingUrl: 'file:///app/index.html' })
  expect(callback).toHaveBeenLastCalledWith(false)
})
