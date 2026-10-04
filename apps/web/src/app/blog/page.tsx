import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { blogDescription as description, feedAlternate, formatDate, listPosts } from '@/lib/blog'
import { jsonLdScript, publisher } from '@/lib/seo'
import { site } from '@/lib/site'
import { gutter, headline, label, labelMono, mastheadRuled, sheet, support } from '@dalliance/brand/ui'

// Search results show the title alone, so it says what the site is, not just "Blog"
const title = `Blog · ${site.name}, the coding agent for researchers`

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/blog', types: feedAlternate },
  // Metadata merges shallowly, so the page restates the whole Open Graph block rather than only the url
  openGraph: { type: 'website', siteName: site.name, locale: 'en_US', title, description, url: '/blog' },
  twitter: { card: 'summary_large_image', title, description },
}

export default async function Blog() {
  const posts = await listPosts()
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    '@id': `${site.url}/blog#blog`,
    url: `${site.url}/blog`,
    name: `${site.name} blog`,
    description,
    inLanguage: 'en',
    publisher,
    blogPost: posts
      .filter((p) => !p.draft)
      .map((p) => ({
        '@type': 'BlogPosting',
        '@id': `${site.url}/blog/${p.slug}#post`,
        url: `${site.url}/blog/${p.slug}`,
        headline: p.title,
        description: p.description,
        datePublished: p.date,
        dateModified: p.updated,
        author: { '@type': 'Person', name: p.author },
      })),
  }
  return (
    <>
      {jsonLdScript(jsonLd)}
      <SiteHeader />
      <div className={sheet}>
        <div className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>
            <a href="/blog/rss.xml">RSS</a>
          </p>
          <h1 className={headline}>Blog</h1>
          <p className={support}>{description}</p>
        </div>
      </div>
      <main id="main" className={sheet}>
        {posts.length === 0 ? (
          <p className={`${gutter} border-b py-8 lg:py-14`}>Nothing here yet.</p>
        ) : (
          <ol>
            {/* Each post a band: its date in the margin, where the other pages put their labels */}
            {posts.map((p) => (
              <li key={p.slug} className={`${gutter} border-b py-8 lg:grid lg:grid-cols-[200px_1fr] lg:gap-14 lg:py-10`}>
                <p className={`${label} mb-3 lg:mb-0 lg:pt-[7px]`}>
                  <time dateTime={p.date}>{formatDate(p.date)}</time>
                  {p.draft && <span className="ml-2 text-ink-faint">Draft</span>}
                </p>
                <div className="max-w-[62ch]">
                  <h2 className="font-serif text-[24px] leading-[1.25] font-medium tracking-[-0.01em] text-balance text-ink">
                    <Link href={`/blog/${p.slug}`} className="no-underline hover:underline">
                      {p.title}
                    </Link>
                  </h2>
                  <p className="mt-2 text-pretty">{p.description}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
      <SiteFooter />
    </>
  )
}
