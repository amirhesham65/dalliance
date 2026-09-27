import type { NextConfig } from 'next'
import { site } from './src/lib/site'

const config: NextConfig = {
  poweredByHeader: false,
  images: { formats: ['image/avif', 'image/webp'] },
  // /download is the one link every button uses, so moving the installer only means changing DALLIANCE_DOWNLOAD_URL
  redirects: async () => [{ source: '/download', destination: site.downloadUrl, permanent: false }],
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

export default config
