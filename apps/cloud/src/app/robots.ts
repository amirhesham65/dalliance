import type { MetadataRoute } from 'next'

/** Nothing here is for search engines: every page is a step in signing in or paying. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
