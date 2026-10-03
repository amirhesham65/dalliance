// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { DOWNLOAD_PAGE, RELEASES, Updates, isNewer, releaseVersion } from './updates'

const YML = `version: 0.4.0
files:
  - url: Dalliance.zip
    sha512: abc
    size: 1
path: Dalliance.zip
sha512: abc
releaseDate: '2026-10-03T10:00:00.000Z'
`

function updates(answer: () => Promise<Response>, version = '0.3.0') {
  const fetch = vi.fn(answer)
  const open = vi.fn(async () => {})
  return { u: new Updates({ version, open, fetch: fetch as unknown as typeof globalThis.fetch }), fetch, open }
}

describe('the release version', () => {
  it('reads the version line of latest-mac.yml', () => {
    expect(releaseVersion(YML)).toBe('0.4.0')
    expect(releaseVersion("version: '1.2.3'\n")).toBe('1.2.3')
    expect(releaseVersion('files: []\n')).toBeNull()
  })

  it('offers only a later plain x.y.z', () => {
    expect(isNewer('0.4.0', '0.3.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.0')).toBe(true)
    expect(isNewer('0.3.0', '0.3.0')).toBe(false)
    expect(isNewer('0.2.9', '0.3.0')).toBe(false)
    expect(isNewer('0.4.0-beta.1', '0.3.0')).toBe(false)
    expect(isNewer('nonsense', '0.3.0')).toBe(false)
  })
})

describe('checking for an update', () => {
  it('finds a newer release and tells listeners once', async () => {
    const { u, fetch } = updates(async () => new Response(YML))
    const heard = vi.fn()
    u.onChange(heard)
    expect(await u.check()).toEqual({ version: '0.4.0' })
    await u.check()
    expect(fetch).toHaveBeenCalledWith(`${RELEASES}/latest-mac.yml`, expect.anything())
    expect(heard).toHaveBeenCalledTimes(1)
    expect(u.current).toEqual({ version: '0.4.0' })
  })

  it('finds nothing when the running app is the latest', async () => {
    const { u } = updates(async () => new Response(YML), '0.4.0')
    expect(await u.check()).toBeNull()
  })

  it("finds nothing for a release without update files, or when GitHub can't be reached", async () => {
    expect(await updates(async () => new Response('Not Found', { status: 404 })).u.check()).toBeNull()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await updates(async () => Promise.reject(new Error('offline'))).u.check()).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("opens the website's download", async () => {
    const { u, open } = updates(async () => new Response(YML))
    await u.download()
    expect(open).toHaveBeenCalledWith(DOWNLOAD_PAGE)
  })
})
