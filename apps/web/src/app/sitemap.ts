import type { MetadataRoute } from 'next'
import { listPosts } from '@/lib/blog'
import { site } from '@/lib/site'

// When the home page's own copy last changed. The privacy page's matches the date it shows
const home = '2026-09-27'
const privacy = '2026-10-03'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = (await listPosts()).filter((p) => !p.draft)
  // The home page and the blog index list the newest posts, so a new post changes them too
  const latest = posts.reduce((max, p) => (p.updated > max ? p.updated : max), '')
  const newer = (day: string) => new Date(latest > day ? latest : day)
  return [
    { url: `${site.url}/`, lastModified: newer(home), changeFrequency: 'weekly', priority: 1 },
    { url: `${site.url}/blog`, lastModified: newer(home), changeFrequency: 'weekly', priority: 0.7 },
    ...posts.map((p) => ({ url: `${site.url}/blog/${p.slug}`, lastModified: new Date(p.updated), changeFrequency: 'monthly' as const, priority: 0.6 })),
    { url: `${site.url}/privacy`, lastModified: new Date(privacy), changeFrequency: 'yearly', priority: 0.3 },
  ]
}
