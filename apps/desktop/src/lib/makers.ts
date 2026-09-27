import type { Provider } from '@ilios/shared/ipc'

// One logo per maker, named after the maker's label: "Moonshot AI" is moonshotai.svg, "Z.ai" is zai.svg
const files = import.meta.glob<string>('/src/assets/makers/*.svg', { eager: true, query: '?url', import: 'default' })
const LOGOS: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.svg$/, ''), url]))

/** Gateway prefixes that don't match the maker's label. */
const ALIASES: Record<string, string> = { spacexai: 'xai', arceeai: 'arcee' }

const slug = (maker: string) => {
  const s = maker.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ALIASES[s] ?? s
}

/** The logo for a maker label or a gateway prefix, or null when there isn't one. */
export const makerLogo = (maker: string): string | null => LOGOS[slug(maker)] ?? null

/** Who makes a model, from its id: the gateway prefixes ids with the maker; the Anthropic API only has Claude. */
export const makerOfModel = (provider: Provider, model: string) => (provider === 'anthropic' ? 'anthropic' : model.split('/')[0])
