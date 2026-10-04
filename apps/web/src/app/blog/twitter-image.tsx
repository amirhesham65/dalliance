import { cardSize, socialCard } from '@/lib/card'
import { blogDescription } from '@/lib/blog'
import { site } from '@/lib/site'

export const alt = `The ${site.name} blog. ${blogDescription}`
export const size = cardSize
export const contentType = 'image/png'

export default function Image() {
  return socialCard({ headline: 'Blog', tagline: blogDescription, footer: `${site.name} blog` })
}
