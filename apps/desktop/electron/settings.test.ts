// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

// A stand-in keychain: "encrypts" by prefixing, and a test can make decryption fail or return garbage
const keychain = vi.hoisted(() => ({
  available: false,
  decrypt: (data: Buffer) => data.toString('utf-8').replace(/^enc:/, ''),
}))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (text: string) => Buffer.from(`enc:${text}`, 'utf-8'),
    decryptString: (data: Buffer) => keychain.decrypt(data),
  },
}))
const decrypt = keychain.decrypt

const dir = () => mkdtempSync(path.join(tmpdir(), 'dalliance-settings-'))

describe('SettingsStore', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    keychain.available = false
    keychain.decrypt = decrypt
  })

  it('reads what an earlier run saved', () => {
    const folder = dir()
    new SettingsStore(folder).addRecent('/notebooks/sales.ipynb')
    expect(new SettingsStore(folder).recent.map((r) => r.path)).toEqual(['/notebooks/sales.ipynb'])
  })

  it('suggests next prompts unless turned off, including for a file saved before the setting existed', () => {
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ provider: 'anthropic', autoTitles: false }))
    const settings = new SettingsStore(folder)
    expect(settings.suggestNext).toBe(true)
    expect(settings.view().suggestNext).toBe(true)

    settings.update({ suggestNext: false })
    expect(new SettingsStore(folder).suggestNext).toBe(false)
    expect(new SettingsStore(folder).view()).toMatchObject({ suggestNext: false, autoTitles: false })
  })

  it.skipIf(process.platform === 'win32')('keeps settings.json private', () => {
    const folder = dir()
    new SettingsStore(folder).update({ autoTitles: false })
    expect(statSync(path.join(folder, 'settings.json')).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['does not parse', '{"provider": "anthropic", "recent": ['],
    ['is not an object', 'null'],
  ])('moves a settings file that %s aside before starting from the defaults', (_what, contents) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const folder = dir()
    writeFileSync(path.join(folder, 'settings.json'), contents)

    const settings = new SettingsStore(folder)
    expect(settings.view()).toMatchObject({ provider: 'gateway', onboarded: false })
    expect(warn).toHaveBeenCalledOnce()

    const aside = readdirSync(folder).filter((f) => f.startsWith('settings.json.corrupt-'))
    expect(aside).toHaveLength(1)
    expect(readFileSync(path.join(folder, aside[0]), 'utf-8')).toBe(contents)

    // The next save writes a fresh file and leaves the old one alone
    settings.update({ autoTitles: false })
    expect(JSON.parse(readFileSync(path.join(folder, 'settings.json'), 'utf-8'))).toMatchObject({ autoTitles: false })
    expect(readFileSync(path.join(folder, aside[0]), 'utf-8')).toBe(contents)
  })

  describe('keys', () => {
    const noEnvKeys = () => {
      vi.stubEnv('AI_GATEWAY_API_KEY', '')
      vi.stubEnv('ANTHROPIC_API_KEY', '')
    }

    it('keeps a key in the keychain when there is one', () => {
      noEnvKeys()
      keychain.available = true
      const folder = dir()
      new SettingsStore(folder).update({ apiKey: { provider: 'gateway', key: ' vck_123 ' } })
      expect(JSON.parse(readFileSync(path.join(folder, 'settings.json'), 'utf-8')).keys.gateway).not.toContain('vck_123')

      const settings = new SettingsStore(folder)
      expect(settings.apiKey('gateway')).toEqual({ key: 'vck_123', source: 'settings' })
      expect(settings.view()).toMatchObject({ keySource: 'settings', unreadableKeys: [], keyStorage: { gateway: 'keychain', anthropic: 'keychain' } })
    })

    it('says a key is stored as plain text when there is no keychain', () => {
      noEnvKeys()
      const folder = dir()
      expect(new SettingsStore(folder).view().keyStorage).toEqual({ gateway: 'plain', anthropic: 'plain' })
      new SettingsStore(folder).update({ apiKey: { provider: 'anthropic', key: 'sk-ant-1' } })
      // A keychain showing up later doesn't change how the saved key is kept
      keychain.available = true
      const view = new SettingsStore(folder).view()
      expect(view.keyStorage).toEqual({ gateway: 'keychain', anthropic: 'plain' })
      expect(view.hasKey.anthropic).toBe(true)
    })

    it.each([
      [
        'decryption fails',
        () => {
          throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
        },
      ],
      ['decryption yields garbage', () => '\uFFFD\u0000\uFFFD'],
      ['decryption yields nothing', () => ''],
    ])('reports a saved key it cannot read when %s', (_what, broken) => {
      noEnvKeys()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      keychain.available = true
      const folder = dir()
      new SettingsStore(folder).update({ apiKey: { provider: 'gateway', key: 'vck_123' } })

      // After an update that changed the app's keychain identity
      keychain.decrypt = broken
      const settings = new SettingsStore(folder)
      expect(settings.apiKey('gateway')).toEqual({ key: null, source: null })
      expect(settings.view()).toMatchObject({ keySource: null, hasKey: { gateway: false }, unreadableKeys: ['gateway'], keyStorage: { gateway: 'keychain' } })
      settings.view()
      expect(warn).toHaveBeenCalledOnce()

      // Pasting it again fixes it
      keychain.decrypt = decrypt
      expect(settings.update({ apiKey: { provider: 'gateway', key: 'vck_456' } })).toMatchObject({ keySource: 'settings', unreadableKeys: [] })
    })

    it('falls back to the environment when the saved key cannot be read', () => {
      noEnvKeys()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      keychain.available = true
      const folder = dir()
      new SettingsStore(folder).update({ apiKey: { provider: 'anthropic', key: 'sk-ant-1' } })
      keychain.decrypt = () => {
        throw new Error('no keychain access')
      }
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env')
      const settings = new SettingsStore(folder)
      expect(settings.apiKey('anthropic')).toEqual({ key: 'sk-ant-env', source: 'environment' })
      expect(settings.view().unreadableKeys).toEqual(['anthropic'])
    })
  })

  describe('Dalliance Cloud', () => {
    const access = { baseURL: 'https://cloud.example/api/ai', signedIn: () => true, token: async () => 'jwt' }

    it("can't be chosen in a build without it", () => {
      const store = new SettingsStore(dir())
      expect(store.update({ provider: 'cloud' }).provider).toBe('gateway')
      expect(store.view().cloud).toBe(false)
    })

    it('runs on the account, with no key and the gateway model default', () => {
      const store = new SettingsStore(dir())
      store.setCloud(access)
      const view = store.update({ provider: 'cloud' })
      expect(view).toMatchObject({ provider: 'cloud', cloud: true, keySource: null, model: 'anthropic/claude-opus-5' })
      expect(store.modelConfig()).toMatchObject({ provider: 'cloud', apiKey: null, cloud: access })
    })

    it('reads as the gateway when a build without it opens settings that chose it', () => {
      const folder = dir()
      writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({ provider: 'cloud', model: 'google/gemini-3.8-flash' }))
      const store = new SettingsStore(folder)
      expect(store.view().provider).toBe('gateway')
      expect(store.modelConfig()).toMatchObject({ provider: 'gateway', model: 'anthropic/claude-opus-5' })
      // And a build with it gets the choice back
      store.setCloud(access)
      expect(store.modelConfig()).toMatchObject({ provider: 'cloud', model: 'google/gemini-3.8-flash' })
    })
  })
})
