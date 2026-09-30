// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deepLinkFromArgv, signInCode } from './config'

describe('signInCode', () => {
  it('reads the code from the sign-in page link', () => {
    expect(signInCode('io.dalliance.app://auth/callback#token=abc123')).toBe('abc123')
  })

  it('ignores every other link', () => {
    for (const link of [
      'io.dalliance.app://billing',
      // One slash makes the path /auth/callback with no host, which the plugin doesn't take either
      'io.dalliance.app:/auth/callback#token=abc123',
      'io.dalliance.app://auth/callback?token=abc123',
      'io.dalliance.app://auth/callback#token=',
      'https://cloud.dalliance.io/auth/callback#token=abc123',
      'not a url',
    ])
      expect(signInCode(link), link).toBeNull()
  })
})

describe('deepLinkFromArgv', () => {
  it('finds a link a second launch passed on Windows and Linux', () => {
    expect(deepLinkFromArgv(['/opt/Dalliance/dalliance', '--flag', 'io.dalliance.app://billing'])).toBe('io.dalliance.app://billing')
    expect(deepLinkFromArgv(['/opt/Dalliance/dalliance', '/notebooks/sales.ipynb'])).toBeNull()
  })
})
