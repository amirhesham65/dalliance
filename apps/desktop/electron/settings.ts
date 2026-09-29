import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { Effort, Provider, SettingsUpdate, SettingsView } from '@dalliance/shared/ipc'
import { DEFAULT_MODELS, type ModelConfig, needsKey } from './harness/model'

interface Stored {
  provider: Provider
  model: string
  /** The model last used with each provider, so switching back finds it again. */
  models: Partial<Record<Provider, string>>
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

/** The variable each keyed provider's key can come from. Ollama on this machine has none. */
export const ENV_KEYS: Partial<Record<Provider, string>> = { gateway: 'AI_GATEWAY_API_KEY', anthropic: 'ANTHROPIC_API_KEY', 'ollama-cloud': 'OLLAMA_API_KEY' }

const DEFAULTS: Stored = {
  provider: 'gateway',
  model: DEFAULT_MODELS.gateway,
  models: {},
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
  /** Keys found in the user's login shell. Kept here, not in process.env, so the kernel never inherits them. */
  private shellKeys: Partial<Record<Provider, string>> = {}

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
    const variable = ENV_KEYS[provider]
    const env = variable ? process.env[variable] : undefined
    if (env) return { key: env, source: 'environment' }
    const shell = this.shellKeys[provider]
    return shell ? { key: shell, source: 'shell' } : { key: null, source: null }
  }

  /**
   * Take the keys the login shell exports. Before the first-run setup is done, switch to a provider that has a key
   * when the chosen one has none, so someone with ANTHROPIC_API_KEY in their profile starts ready.
   */
  useShellKeys(env: Record<string, string>) {
    for (const provider of Object.keys(ENV_KEYS) as Provider[]) {
      const key = env[ENV_KEYS[provider]!]
      if (key) this.shellKeys[provider] = key
    }
    if (this.data.onboarded || this.apiKey(this.data.provider).key) return
    const other = (Object.keys(ENV_KEYS) as Provider[]).find((p) => this.apiKey(p).key)
    if (other) this.update({ provider: other })
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
      keySource: needsKey(this.data.provider) ? this.apiKey(this.data.provider).source : 'none needed',
      hasKey: {
        gateway: this.apiKey('gateway').key != null,
        anthropic: this.apiKey('anthropic').key != null,
        'ollama-cloud': this.apiKey('ollama-cloud').key != null,
        'ollama-local': true,
      },
    }
  }

  update(update: SettingsUpdate): SettingsView {
    if (update.provider && update.provider !== this.data.provider) {
      // Each provider has its own model ids, so a switch brings back the one last used there, or its default
      this.data.models[this.data.provider] = this.data.model
      this.data.model = this.data.models[update.provider] ?? DEFAULT_MODELS[update.provider]
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
