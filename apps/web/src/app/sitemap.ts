import type { MetadataRoute } from 'next'
import { site } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date('2026-09-27')
  return [
    { url: `${site.url}/`, lastModified: updated, changeFrequency: 'weekly', priority: 1 },
    { url: `${site.url}/privacy`, lastModified: updated, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
