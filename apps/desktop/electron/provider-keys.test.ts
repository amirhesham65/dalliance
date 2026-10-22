// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type KeyEncryption, ProviderKeys } from './provider-keys'
import { pythonEnv, redactSecrets } from './secrets'

const encryption: KeyEncryption = {
  available: () => true,
  encrypt: (value) => Buffer.from(`encrypted:${value}`),
  decrypt: (value) => {
    const text = value.toString()
    if (!text.startsWith('encrypted:')) throw new Error('Invalid test ciphertext')
    return text.slice(10)
  },
}
const folders: string[] = []
const folder = () => { const dir = mkdtempSync(path.join(tmpdir(), 'dalliance-keys-')); folders.push(dir); return dir }
afterEach(() => folders.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('provider keys', () => {
  it('encrypts keys, returns only status, and restores and deletes them independently', () => {
    const dir = folder()
    const keys = new ProviderKeys(dir, encryption)
    const view = keys.set('anthropic', 'test-anthropic-key')
    keys.set('google', 'test-google-key')
    keys.set('openai', 'test-openai-key')
    const file = path.join(dir, 'provider-keys.json')
    expect(readFileSync(file, 'utf8')).not.toContain('test-anthropic-key')
    expect(JSON.stringify(view)).not.toContain('test-anthropic-key')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    const reopened = new ProviderKeys(dir, encryption)
    expect(reopened.get('anthropic')).toBe('test-anthropic-key')
    expect(reopened.view().configured).toEqual({ anthropic: true, google: true, openai: true })
    reopened.set('anthropic', '')
    const afterDelete = new ProviderKeys(dir, encryption)
    expect(afterDelete.get('anthropic')).toBeNull()
    expect(afterDelete.get('google')).toBe('test-google-key')
    expect(afterDelete.get('openai')).toBe('test-openai-key')
  })

  it('keeps keys in memory when secure storage is unavailable, with no plaintext fallback', () => {
    const dir = folder()
    const unavailable = { ...encryption, available: () => false }
    const keys = new ProviderKeys(dir, unavailable)
    expect(keys.set('openai', 'session-only-key')).toMatchObject({ persistent: false, configured: { openai: true } })
    expect(keys.get('openai')).toBe('session-only-key')
    expect(readFileSync(path.join(dir, 'provider-keys.json'), 'utf8')).not.toContain('session-only-key')
    expect(new ProviderKeys(dir, unavailable).get('openai')).toBeNull()
  })

  it('removes an old saved key when secure storage is unavailable', () => {
    const dir = folder()
    new ProviderKeys(dir, encryption).set('openai', 'old-test-key')
    new ProviderKeys(dir, { ...encryption, available: () => false }).set('openai', '')
    expect(new ProviderKeys(dir, encryption).get('openai')).toBeNull()
  })

  it('reports unreadable keys without leaking file contents or encryption errors', () => {
    const dir = folder()
    writeFileSync(path.join(dir, 'provider-keys.json'), JSON.stringify({ openai: Buffer.from('broken-ciphertext').toString('base64') }))
    const keys = new ProviderKeys(dir, encryption)
    expect(keys.get('openai')).toBeNull()
    expect(keys.view().error).toContain("couldn't be opened")
    expect(JSON.stringify(keys.view())).not.toContain('broken-ciphertext')
    expect(() => keys.set('invalid', 'test')).toThrow('Choose a provider')
    expect(() => keys.set('openai', 'key with spaces')).toThrow('cannot contain spaces')
  })

  it('redacts current and replaced keys, and keeps provider environment keys out of Python', () => {
    const keys = new ProviderKeys(folder(), encryption)
    keys.set('anthropic', 'old-dummy-key')
    keys.set('anthropic', 'new-dummy-key')
    expect(redactSecrets('Error old-dummy-key new-dummy-key')).toBe('Error [redacted] [redacted]')
    expect(pythonEnv({ PATH: '/bin', OPENAI_API_KEY: 'dummy', ANTHROPIC_API_KEY: 'dummy', GOOGLE_GENERATIVE_AI_API_KEY: 'dummy', GEMINI_API_KEY: 'dummy' })).toEqual({ PATH: '/bin' })
  })
})
