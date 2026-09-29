import type { DallianceApi, Provider, SettingsView } from '@dalliance/shared/ipc'

export const PROVIDERS: Record<
  Provider,
  { label: string; blurb: string; keyLabel: string; placeholder: string; env: string; keysUrl: string; keysSite: string; needsKey: boolean }
> = {
  gateway: {
    label: 'Vercel AI Gateway',
    blurb: 'One key for Claude, GPT, Gemini and others. Switch models any time.',
    keyLabel: 'AI Gateway key',
    placeholder: 'vck_…',
    env: 'AI_GATEWAY_API_KEY',
    // Vercel's link to the AI Gateway keys page of whichever team the user picks
    keysUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Get+an+AI+Gateway+key',
    keysSite: 'Vercel',
    needsKey: true,
  },
  anthropic: {
    label: 'Anthropic API',
    blurb: 'Claude models only, billed by Anthropic.',
    keyLabel: 'Anthropic API key',
    placeholder: 'sk-ant-…',
    env: 'ANTHROPIC_API_KEY',
    keysUrl: 'https://platform.claude.com/settings/keys',
    keysSite: 'the Claude Console',
    needsKey: true,
  },
  'ollama-cloud': {
    label: 'Ollama - Cloud',
    blurb: 'Open models that Ollama hosts. Your plan decides which ones run.',
    keyLabel: 'Ollama API key',
    placeholder: 'Paste your Ollama key',
    env: 'OLLAMA_API_KEY',
    keysUrl: 'https://ollama.com/settings/keys',
    keysSite: 'Ollama',
    needsKey: true,
  },
  'ollama-local': {
    label: 'Ollama - Local',
    blurb: 'Models on this Mac, run by the Ollama app. No key, and nothing leaves the machine.',
    keyLabel: 'Ollama',
    placeholder: '',
    env: '',
    keysUrl: 'https://ollama.com/download',
    keysSite: 'Ollama',
    needsKey: false,
  },
}

/** Which provider a key belongs to, from its prefix, or null when it doesn't say. */
export function providerForKey(key: string): Provider | null {
  const k = key.trim()
  if (k.startsWith('vck_')) return 'gateway'
  if (k.startsWith('sk-ant-')) return 'anthropic'
  return null
}

/** How a key got there, for the line under a saved key. */
export function keySourceText(settings: SettingsView): string {
  const env = PROVIDERS[settings.provider].env
  if (settings.keySource === 'none needed') return 'Ollama runs on this Mac and needs no key.'
  if (settings.keySource === 'environment') return `Using ${env} from the environment.`
  if (settings.keySource === 'shell') return `Using ${env} from your shell profile.`
  return 'Key saved in your system keychain.'
}

export interface SavedKey {
  /** The new settings when the key was saved, null when the provider turned it down. */
  view: SettingsView | null
  /** What the provider said: the balance, or that it couldn't be reached. */
  note: string | null
  error: string | null
}

/**
 * Check a pasted key with its provider, then save it. The prefix picks the provider, so a key pasted under the
 * wrong one still lands in the right place. A key the provider rejects is not saved. One that couldn't be checked,
 * say offline, is saved with a note, since the next run will say soon enough if it's wrong.
 */
export async function saveKey(api: DallianceApi, current: Provider, raw: string): Promise<SavedKey> {
  const key = raw.trim()
  const provider = providerForKey(key) ?? current
  const check = await api.checkKey(provider, key)
  if (check.status === 'rejected') return { view: null, note: null, error: check.detail }
  const view = await api.updateSettings({ provider, apiKey: { provider, key } })
  const note =
    check.status === 'ok'
      ? check.detail
        ? `Key works. ${check.detail}.`
        : 'Key works.'
      : `Saved, but ${PROVIDERS[provider].label} couldn't be reached to check it.`
  return { view, note, error: null }
}
