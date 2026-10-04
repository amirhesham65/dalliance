import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Act, SiteFooter, SiteHeader } from '@/components/Chrome'
import { CoverImage } from '@/components/CoverImage'
import { feedAlternate, formatDate, listPosts, loadPost } from '@/lib/blog'
import { jsonLdScript, publisher } from '@/lib/seo'
import { site } from '@/lib/site'
import { gutter, headline, label, labelMono, mastheadRuled, sheet, support } from '@dalliance/brand/ui'

// Every post is built ahead of time; any other slug is a 404
export const dynamicParams = false

export async function generateStaticParams() {
  return (await listPosts()).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const found = await loadPost((await params).slug)
  if (!found) return {}
  const { post } = found
  const url = `/blog/${post.slug}`
  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author, url: site.url }],
    alternates: { canonical: url, types: feedAlternate },
    // Metadata merges shallowly, so the page restates the whole Open Graph block rather than only the url
    openGraph: {
      type: 'article',
      siteName: site.name,
      locale: 'en_US',
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.date,
      modifiedTime: post.updated,
      authors: [post.author],
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.description },
    ...(post.draft && { robots: { index: false } }),
  }
}

export default async function BlogPost({ params }: PageProps<'/blog/[slug]'>) {
  const found = await loadPost((await params).slug)
  if (!found) notFound()
  const { post, Body } = found
  const url = `${site.url}/blog/${post.slug}`

  // The article for rich results, and the trail back to the blog for the breadcrumb under the link
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#post`,
        mainEntityOfPage: url,
        url,
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.updated,
        // The cover when there is one; the social card is the image every post has
        image: [...(post.cover ? [`${site.url}${post.cover.light.src}`] : []), `${url}/opengraph-image`],
        author: { '@type': 'Person', name: post.author, url: site.url },
        publisher,
        isPartOf: { '@type': 'Blog', '@id': `${site.url}/blog#blog`, name: `${site.name} blog`, url: `${site.url}/blog` },
        inLanguage: 'en',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.name, item: `${site.url}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${site.url}/blog` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  }

  return (
    <>
      {jsonLdScript(jsonLd)}
      <SiteHeader />
      <main id="main">
        {/* One article from the headline to the last source, so readers and crawlers take it as a whole */}
        <article>
          <header className={sheet}>
            <div className={mastheadRuled}>
              <p className={`${labelMono} mb-4`}>
                <Link href="/blog">Blog</Link>
                {post.draft && <span className="ml-2 text-ink-faint">Draft</span>}
              </p>
              <h1 className={headline}>{post.title}</h1>
              <p className={support}>{post.description}</p>
            </div>
            {post.cover && <CoverImage cover={post.cover} />}
          </header>
          <div className={`${sheet} ${gutter} border-b py-8 lg:grid lg:grid-cols-[200px_1fr] lg:gap-14 lg:py-14`}>
            {/* The byline sits in the margin, where every other band keeps its label */}
            <p className={`${label} mb-6 lg:mb-0 lg:pt-[5px]`}>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span className="block">{post.author}</span>
            </p>
            <div className="max-w-[62ch] min-w-0">
              <Body />
            </div>
          </div>
        </article>
        <div className={`${sheet} ${gutter} border-b py-14 lg:py-22`}>
          <p className="max-w-[30ch] font-serif text-[30px] leading-[1.3] font-medium tracking-[-0.02em] text-ink lg:text-[40px]">Write the question. Keep the code.</p>
          <Act from="blog" />
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
