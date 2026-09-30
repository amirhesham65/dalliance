import type { DallianceApi, KeyProvider, Provider, SettingsView } from '@dalliance/shared/ipc'

export const PROVIDERS: Record<KeyProvider, { label: string; blurb: string; keyLabel: string; placeholder: string; env: string; keysUrl: string; keysSite: string }> = {
  gateway: {
    label: 'Vercel AI Gateway',
    blurb: 'One key for Claude, GPT, Gemini and others. Switch models any time.',
    keyLabel: 'AI Gateway key',
    placeholder: 'vck_…',
    env: 'AI_GATEWAY_API_KEY',
    // Vercel's link to the AI Gateway keys page of whichever team the user picks
    keysUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Get+an+AI+Gateway+key',
    keysSite: 'Vercel',
  },
  anthropic: {
    label: 'Anthropic API',
    blurb: 'Claude models only, billed by Anthropic.',
    keyLabel: 'Anthropic API key',
    placeholder: 'sk-ant-…',
    env: 'ANTHROPIC_API_KEY',
    keysUrl: 'https://platform.claude.com/settings/keys',
    keysSite: 'the Claude Console',
  },
}

/** Which provider a key belongs to, from its prefix, or null when it doesn't say. */
export function providerForKey(key: string): KeyProvider | null {
  const k = key.trim()
  if (k.startsWith('vck_')) return 'gateway'
  if (k.startsWith('sk-ant-')) return 'anthropic'
  return null
}

/** Dalliance Cloud's entry in the provider list, in builds that have it. It runs on the account, not a key. */
export const CLOUD = {
  label: 'Dalliance Cloud',
  blurb: 'No key needed. Claude, GPT, Gemini and others on your Dalliance plan, paid for in credits.',
}

/** The provider's name, for menus and labels. */
export const providerLabel = (provider: Provider) => (provider === 'cloud' ? CLOUD.label : PROVIDERS[provider].label)

/** How a key got there, for the line under a saved key. */
export function keySourceText(settings: SettingsView): string {
  if (settings.provider === 'cloud') return ''
  const env = PROVIDERS[settings.provider].env
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
  // A key without a telltale prefix, pasted with Dalliance Cloud chosen, is taken for a gateway key
  const provider = providerForKey(key) ?? (current === 'cloud' ? 'gateway' : current)
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
