import { cardSize, socialCard } from '@/lib/card'
import { listPosts, loadPost } from '@/lib/blog'
import { site } from '@/lib/site'

export const alt = `A post on the ${site.name} blog`
export const size = cardSize
export const contentType = 'image/png'

// Drawn once per post at build time, like the pages
export async function generateStaticParams() {
  return (await listPosts()).map((p) => ({ slug: p.slug }))
}

/** The site's card with the post's title and summary in place of the headline and tagline */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const found = await loadPost((await params).slug)
  if (!found) return socialCard()
  return socialCard({ headline: found.post.title, tagline: found.post.description, footer: `${site.name} blog` })
}
