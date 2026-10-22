import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ProviderKeysView } from '@dalliance/shared/ipc'
import { isProvider, PROVIDERS, type ProviderId } from '@dalliance/shared/models'
import { writeFileAtomicSync } from './atomic-write'
import { rememberSecret } from './secrets'

export interface KeyEncryption {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

/** Encrypted on disk, usable only in the main process. Encryption is checked after Electron is ready. */
export class ProviderKeys {
  private readonly file: string
  private loaded = false
  private values: Partial<Record<ProviderId, string>> = {}
  private encrypted: Partial<Record<ProviderId, string>> = {}
  private error: string | null = null

  private readonly encryption: KeyEncryption

  constructor(dir: string, encryption: KeyEncryption) {
    this.encryption = encryption
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'provider-keys.json')
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.file)) return
    try {
      const stored: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error()
      for (const provider of PROVIDERS) {
        const value = (stored as Record<string, unknown>)[provider]
        if (value !== undefined && typeof value !== 'string') throw new Error()
        if (typeof value === 'string') this.encrypted[provider] = value
      }
      if (!this.encryption.available()) return
      const values: Partial<Record<ProviderId, string>> = {}
      for (const provider of PROVIDERS) {
        const value = this.encrypted[provider]
        if (value) {
          values[provider] = this.encryption.decrypt(Buffer.from(value, 'base64'))
          rememberSecret(values[provider]!)
        }
      }
      this.values = values
    } catch {
      this.error = "Saved API keys couldn't be opened. Add your keys again in Settings > Models."
    }
  }

  get = (provider: ProviderId): string | null => {
    this.load()
    return this.values[provider] ?? null
  }

  view(): ProviderKeysView {
    this.load()
    return {
      configured: Object.fromEntries(PROVIDERS.map((provider) => [provider, Boolean(this.values[provider])])) as Record<ProviderId, boolean>,
      persistent: this.encryption.available(),
      error: this.error,
    }
  }

  set(provider: unknown, input: unknown): ProviderKeysView {
    if (!isProvider(provider) || typeof input !== 'string' || input.length > 8192) throw new Error('Choose a provider and enter a valid API key.')
    this.load()
    const key = input.trim()
    if (/\s/.test(key)) throw new Error('API keys cannot contain spaces or line breaks.')
    const encrypted = { ...this.encrypted }
    try {
      if (key && this.encryption.available()) encrypted[provider] = this.encryption.encrypt(key).toString('base64')
      else delete encrypted[provider]
      // Remove any earlier saved key even when the replacement can only last for this session.
      writeFileAtomicSync(this.file, JSON.stringify(encrypted), { mode: 0o600 })
    } catch {
      throw new Error("Couldn't save the API key. Check access to the app's settings folder.")
    }
    this.encrypted = encrypted
    this.values = { ...this.values, [provider]: key }
    rememberSecret(key)
    this.error = null
    return this.view()
  }
}
