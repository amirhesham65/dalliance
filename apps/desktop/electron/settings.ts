import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { Effort, KeyProvider, KeyStorage, Provider, SettingsUpdate, SettingsView } from '@dalliance/shared/ipc'
import { writeFileAtomicSync } from './atomic-write'
import { type CloudAccess, DEFAULT_MODELS, type ModelConfig } from './harness/model'

interface Stored {
  provider: Provider
  model: string
  effort: Effort
  pythonPath: string | null
  approvalMode: 'interactive' | 'background'
  autoTitles: boolean
  suggestNext: boolean
  onboarded: boolean
  /** The folder in use: where new notebooks go, and where the kernel and the agent work. Null for the default one. */
  workspaceDir: string | null
  /** Encrypted with the OS keychain when available. */
  keys: Partial<Record<KeyProvider, string>>
  /** Notebooks opened or saved lately, newest first. */
  recent: { path: string; openedAt: number }[]
}

const MAX_RECENT = 8

import { ENV_KEYS } from './env-keys'
export { ENV_KEYS }

const KEY_PROVIDERS: KeyProvider[] = ['gateway', 'anthropic']

/** A decrypted key is printable ASCII without spaces. Anything else is what a different keychain identity yields. */
const looksLikeKey = (key: string) => /^[\x21-\x7e]+$/.test(key)

const DEFAULTS: Stored = {
  provider: 'gateway',
  model: DEFAULT_MODELS.gateway,
  effort: 'medium',
  pythonPath: null,
  approvalMode: 'interactive',
  autoTitles: true,
  suggestNext: true,
  onboarded: false,
  workspaceDir: null,
  keys: {},
  recent: [],
}

export class SettingsStore {
  private data: Stored
  private readonly file: string
  /** Keys found in the user's login shell. Kept here, not in process.env, so the kernel never inherits them. */
  private shellKeys: Partial<Record<KeyProvider, string>> = {}
  /** Providers whose unreadable key was already logged, so the log gets one line each, not one per view. */
  private warned = new Set<KeyProvider>()
  /** How to reach Dalliance Cloud, in builds that have it. See setCloud. */
  private cloud: CloudAccess | null = null

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'settings.json')
    this.data = structuredClone(DEFAULTS)
    if (existsSync(this.file)) {
      let stored: Partial<Stored>
      try {
        stored = JSON.parse(readFileSync(this.file, 'utf-8'))
        if (typeof stored !== 'object' || stored == null || Array.isArray(stored)) throw new Error('not a JSON object')
      } catch (err) {
        this.setAside(err)
        return
      }
      // Settings from before the first-run setup existed: anyone who has opened a notebook is past it
      this.data = { ...structuredClone(DEFAULTS), onboarded: (stored.recent?.length ?? 0) > 0, ...stored }
    }
  }

  /**
   * A settings file that can't be read falls back to the defaults. It's moved aside first, so the next save
   * doesn't overwrite the stored keys and recent notebooks it may still hold.
   */
  private setAside(reason: unknown) {
    const aside = `${this.file}.corrupt-${Date.now()}`
    try {
      renameSync(this.file, aside)
      console.warn(`settings.json could not be read (${String(reason)}). Moved it to ${aside} and started from the defaults.`)
    } catch (err) {
      console.warn(`settings.json could not be read (${String(reason)}), and moving it aside failed (${String(err)}).`)
    }
  }

  private save() {
    writeFileAtomicSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  /**
   * The saved key, or `unreadable` when one is saved but can't be decrypted. That happens when an update changes
   * the app's keychain identity, or the keychain is gone. The key is still in the file; only pasting it again helps.
   */
  private storedKey(provider: KeyProvider): { key: string | null; unreadable: boolean } {
    const value = this.data.keys[provider]
    if (!value) return { key: null, unreadable: false }
    if (value.startsWith('plain:')) return { key: value.slice(6) || null, unreadable: false }
    let reason = 'it decrypted to something that is not a key'
    try {
      const key = safeStorage.decryptString(Buffer.from(value, 'base64'))
      if (looksLikeKey(key)) return { key, unreadable: false }
    } catch (err) {
      reason = String(err)
    }
    if (!this.warned.has(provider)) {
      this.warned.add(provider)
      console.warn(`The saved ${provider} key could not be read (${reason}). It has to be entered again.`)
    }
    return { key: null, unreadable: true }
  }

  /** How the provider's key is kept: the saved key's form, or how a new key would be saved. */
  private keyStorage(provider: KeyProvider): KeyStorage {
    const value = this.data.keys[provider]
    if (value) return value.startsWith('plain:') ? 'plain' : 'keychain'
    return safeStorage.isEncryptionAvailable() ? 'keychain' : 'plain'
  }

  apiKey(provider: Provider): { key: string | null; source: SettingsView['keySource'] } {
    // Dalliance Cloud runs on the account, never a key
    if (provider === 'cloud') return { key: null, source: null }
    const stored = this.storedKey(provider).key
    if (stored) return { key: stored, source: 'settings' }
    const env = process.env[ENV_KEYS[provider]]
    if (env) return { key: env, source: 'environment' }
    const shell = this.shellKeys[provider]
    return shell ? { key: shell, source: 'shell' } : { key: null, source: null }
  }

  /**
   * Take the keys the login shell exports. Before the first-run setup is done, switch to a provider that has a key
   * when the chosen one has none, so someone with ANTHROPIC_API_KEY in their profile starts ready.
   */
  useShellKeys(env: Record<string, string>) {
    for (const provider of KEY_PROVIDERS) {
      const key = env[ENV_KEYS[provider]]
      if (key) this.shellKeys[provider] = key
    }
    if (this.data.onboarded || this.provider === 'cloud' || this.apiKey(this.provider).key) return
    const other = KEY_PROVIDERS.find((p) => this.apiKey(p).key)
    if (other) this.update({ provider: other })
  }

  /** Turns Dalliance Cloud on for this run of the app. Builds without it never call this. */
  setCloud(access: CloudAccess) {
    this.cloud = access
  }

  /**
   * The chosen provider. Dalliance Cloud chosen in a build that doesn't have it, like after switching from the
   * official app to a fork, reads as the gateway, so Settings never shows a choice it can't offer.
   */
  private get provider(): Provider {
    return this.data.provider === 'cloud' && !this.cloud ? 'gateway' : this.data.provider
  }

  modelConfig(): ModelConfig {
    const provider = this.provider
    const model = provider === this.data.provider ? this.data.model : DEFAULT_MODELS[provider]
    return { provider, model, effort: this.data.effort, apiKey: this.apiKey(provider).key, cloud: this.cloud }
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

  get suggestNext() {
    return this.data.suggestNext
  }

  /** The folder last worked in, if it is still there. */
  get workspaceDir() {
    const dir = this.data.workspaceDir
    return dir && existsSync(dir) ? dir : null
  }

  setWorkspaceDir(dir: string) {
    if (dir === this.data.workspaceDir) return
    this.data.workspaceDir = dir
    this.save()
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
      provider: this.provider,
      model: this.modelConfig().model,
      effort: this.data.effort,
      pythonPath: this.data.pythonPath,
      approvalMode: this.data.approvalMode,
      autoTitles: this.data.autoTitles,
      suggestNext: this.data.suggestNext,
      onboarded: this.data.onboarded,
      keySource: this.apiKey(this.provider).source,
      hasKey: { gateway: this.apiKey('gateway').key != null, anthropic: this.apiKey('anthropic').key != null },
      unreadableKeys: KEY_PROVIDERS.filter((p) => this.storedKey(p).unreadable),
      keyStorage: { gateway: this.keyStorage('gateway'), anthropic: this.keyStorage('anthropic') },
      cloud: this.cloud != null,
    }
  }

  update(update: SettingsUpdate): SettingsView {
    // Dalliance Cloud can only be chosen in a build that has it
    const provider = update.provider === 'cloud' && !this.cloud ? undefined : update.provider
    if (provider && provider !== this.data.provider) {
      // Switching provider resets a default model name to the other provider's format
      if (this.data.model === DEFAULT_MODELS[this.data.provider]) this.data.model = DEFAULT_MODELS[provider]
      this.data.provider = provider
    }
    if (update.model !== undefined) this.data.model = update.model.trim() || DEFAULT_MODELS[this.data.provider]
    if (update.effort) this.data.effort = update.effort
    if (update.pythonPath !== undefined) this.data.pythonPath = update.pythonPath?.trim().replace(/^~(?=$|\/)/, homedir()) || null
    if (update.approvalMode) this.data.approvalMode = update.approvalMode
    if (update.autoTitles !== undefined) this.data.autoTitles = update.autoTitles
    if (update.suggestNext !== undefined) this.data.suggestNext = update.suggestNext
    if (update.onboarded !== undefined) this.data.onboarded = update.onboarded
    if (update.apiKey) {
      const { provider, key } = update.apiKey
      const trimmed = key.trim()
      this.warned.delete(provider)
      if (!trimmed) delete this.data.keys[provider]
      else if (safeStorage.isEncryptionAvailable()) this.data.keys[provider] = safeStorage.encryptString(trimmed).toString('base64')
      else this.data.keys[provider] = `plain:${trimmed}`
    }
    this.save()
    return this.view()
  }
}
