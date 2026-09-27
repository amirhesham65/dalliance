import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { Effort, Provider, SettingsUpdate, SettingsView } from '../src/shared/ipc'
import { DEFAULT_MODELS, type ModelConfig } from './harness/model'

interface Stored {
  provider: Provider
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  autoTitles: boolean
  onboarded: boolean
  /** Encrypted with the OS keychain when available. */
  keys: Partial<Record<Provider, string>>
  /** Notebooks opened or saved lately, newest first. */
  recent: { path: string; openedAt: number }[]
}

const MAX_RECENT = 8

const ENV_KEYS: Record<Provider, string> = { gateway: 'AI_GATEWAY_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }

const DEFAULTS: Stored = {
  provider: 'gateway',
  model: DEFAULT_MODELS.gateway,
  effort: 'medium',
  pythonPath: null,
  approvalMode: 'interactive',
  autoTitles: true,
  onboarded: false,
  keys: {},
  recent: [],
}

export class SettingsStore {
  private data: Stored
  private readonly file: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'settings.json')
    this.data = { ...DEFAULTS }
    if (existsSync(this.file)) {
      try {
        const stored = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<Stored>
        // Settings from before the first-run setup existed: anyone who has opened a notebook is past it
        this.data = { ...DEFAULTS, onboarded: (stored.recent?.length ?? 0) > 0, ...stored }
      } catch {
        // A corrupt settings file falls back to the defaults
      }
    }
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  private storedKey(provider: Provider): string | null {
    const value = this.data.keys[provider]
    if (!value) return null
    if (value.startsWith('plain:')) return value.slice(6)
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return null
    }
  }

  apiKey(provider: Provider): { key: string | null; source: SettingsView['keySource'] } {
    const stored = this.storedKey(provider)
    if (stored) return { key: stored, source: 'settings' }
    const env = process.env[ENV_KEYS[provider]]
    return env ? { key: env, source: 'environment' } : { key: null, source: null }
  }

  modelConfig(): ModelConfig {
    return { provider: this.data.provider, model: this.data.model, effort: this.data.effort, apiKey: this.apiKey(this.data.provider).key }
  }

  get pythonPath() {
    return this.data.pythonPath
  }

  get approvalMode() {
    return this.data.approvalMode
  }

  get autoTitles() {
    return this.data.autoTitles
  }

  get recent() {
    return this.data.recent
  }

  addRecent(file: string) {
    this.data.recent = [{ path: file, openedAt: Date.now() }, ...this.data.recent.filter((r) => r.path !== file)].slice(0, MAX_RECENT)
    this.save()
  }

  removeRecent(file: string) {
    this.data.recent = this.data.recent.filter((r) => r.path !== file)
    this.save()
  }

  view(): SettingsView {
    return {
      provider: this.data.provider,
      model: this.data.model,
      effort: this.data.effort,
      pythonPath: this.data.pythonPath,
      approvalMode: this.data.approvalMode,
      autoTitles: this.data.autoTitles,
      onboarded: this.data.onboarded,
      keySource: this.apiKey(this.data.provider).source,
      hasKey: { gateway: this.apiKey('gateway').key != null, anthropic: this.apiKey('anthropic').key != null },
    }
  }

  update(update: SettingsUpdate): SettingsView {
    if (update.provider && update.provider !== this.data.provider) {
      // Switching provider resets a default model name to the other provider's format
      if (this.data.model === DEFAULT_MODELS[this.data.provider]) this.data.model = DEFAULT_MODELS[update.provider]
      this.data.provider = update.provider
    }
    if (update.model !== undefined) this.data.model = update.model.trim() || DEFAULT_MODELS[this.data.provider]
    if (update.effort) this.data.effort = update.effort
    if (update.pythonPath !== undefined) this.data.pythonPath = update.pythonPath?.trim().replace(/^~(?=$|\/)/, homedir()) || null
    if (update.approvalMode) this.data.approvalMode = update.approvalMode
    if (update.autoTitles !== undefined) this.data.autoTitles = update.autoTitles
    if (update.onboarded !== undefined) this.data.onboarded = update.onboarded
    if (update.apiKey) {
      const { provider, key } = update.apiKey
      const trimmed = key.trim()
      if (!trimmed) delete this.data.keys[provider]
      else if (safeStorage.isEncryptionAvailable()) this.data.keys[provider] = safeStorage.encryptString(trimmed).toString('base64')
      else this.data.keys[provider] = `plain:${trimmed}`
    }
    this.save()
    return this.view()
  }
}
