import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@dalliance/brand', '@dalliance/shared'],
  poweredByHeader: false,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        // Every page here is a step in signing in or paying, so none may be indexed
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
  // Nothing lives at the root. People who land there want the website
  redirects: async () => [{ source: '/', destination: 'https://dalliance.io', permanent: false }],
}

export default config
