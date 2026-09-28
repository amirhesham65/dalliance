import { Redis } from '@upstash/redis'
import { after, type NextRequest, userAgent } from 'next/server'
import { site } from '@/lib/site'

// Temporary: logs each download until there is a better home for it. Reads the Upstash Marketplace
// integration's KV_REST_API_* variables or UPSTASH_REDIS_REST_*; with neither set it only redirects
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
const redis = url && token ? new Redis({ url, token }) : null

export function GET(request: NextRequest) {
  const ua = userAgent(request)
  if (redis && !ua.isBot) {
    const h = request.headers
    const entry = {
      t: new Date().toISOString(),
      from: request.nextUrl.searchParams.get('from'),
      // Vercel's geo headers; the city arrives URL-encoded. No IP is stored
      country: h.get('x-vercel-ip-country'),
      region: h.get('x-vercel-ip-country-region'),
      city: decode(h.get('x-vercel-ip-city')),
      referrer: source(h.get('referer'), request.nextUrl.host),
      browser: ua.browser.name ?? null,
      os: ua.os.name ?? null,
      device: ua.device.type ?? 'desktop',
    }
    // After the response, so a slow or failing write never holds up the download
    after(() => redis.lpush('downloads', entry).catch((error) => console.error('download log failed', error)))
  }
  return Response.redirect(site.downloadUrl, 307)
}

/** The page's path when the click came from this site, otherwise only the other site's host, never a query */
function source(referrer: string | null, self: string) {
  if (!referrer) return null
  try {
    const from = new URL(referrer)
    return from.host === self ? from.pathname : from.host
  } catch {
    return null
  }
}

function decode(value: string | null) {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
