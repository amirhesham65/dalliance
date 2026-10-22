import type { ModelOption } from './ipc'

export const PROVIDERS = ['anthropic', 'google', 'openai'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const PROVIDER_NAMES: Record<ProviderId, string> = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI' }
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'anthropic/claude-sonnet-5-5',
  google: 'google/gemini-3.8-flash',
  openai: 'openai/gpt-6.1-sol',
}

/** Provider-native IDs. This catalog needs no network request or credentials. */
export const MODELS: readonly ModelOption[] = [
  { id: DEFAULT_MODELS.anthropic, name: 'Claude Sonnet 5.5', maker: 'Anthropic' },
  { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', maker: 'Anthropic' },
  { id: 'anthropic/claude-haiku-5-5', name: 'Claude Haiku 5.5', maker: 'Anthropic' },
  { id: DEFAULT_MODELS.google, name: 'Gemini 3.8 Flash', maker: 'Google' },
  { id: 'google/gemini-4-argon', name: 'Gemini 4 Argon', maker: 'Google' },
  { id: DEFAULT_MODELS.openai, name: 'GPT-6.1 Sol', maker: 'OpenAI' },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', maker: 'OpenAI' },
]

export function isProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
}

export function providerOf(model: string): ProviderId | null {
  const provider = model.split('/')[0]
  return isProvider(provider) ? provider : null
}

export function normalizeModel(model: string): string {
  return model.startsWith('anthropic/') ? model.replace(/(\d)\.(?=\d)/g, '$1-') : model
}
