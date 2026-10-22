const files = import.meta.glob<string>('/src/assets/makers/*.svg', { eager: true, query: '?url', import: 'default' })
const LOGOS: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.svg$/, ''), url]))
export const makerLogo = (maker: string): string | null => LOGOS[maker.toLowerCase()] ?? null
export const makerOfModel = (model: string) => model.split('/')[0]
