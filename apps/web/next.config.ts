import type { NextConfig } from 'next'
import createMDX from '@next/mdx'

const config: NextConfig = {
  transpilePackages: ['@dalliance/brand'],
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      ],
    },
  ],
}

// Blog posts are MDX in src/content/blog. Plugins are named as strings, since Turbopack can't take functions
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm', 'remark-frontmatter', 'remark-mdx-frontmatter'],
    rehypePlugins: ['rehype-slug'],
    // Footnotes, [^1] in a post, collect under a visible Sources heading at the end
    remarkRehypeOptions: { footnoteLabel: 'Sources', footnoteLabelProperties: { className: [] } },
  },
})

export default withMDX(config)
