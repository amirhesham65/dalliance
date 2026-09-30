import type { Provider } from '@dalliance/shared/ipc'

/**
 * The environment variable that holds each provider's API key. Kept free of Electron imports so the kernel,
 * which strips these from its child's environment, can load it in plain Node tests.
 */
export const ENV_KEYS: Record<Provider, string> = { gateway: 'AI_GATEWAY_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }
