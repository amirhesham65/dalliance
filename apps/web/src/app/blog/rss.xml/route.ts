import { blogDescription, listPosts } from '@/lib/blog'
import { site } from '@/lib/site'

// Built once with the site, like the posts it lists
export const dynamic = 'force-static'

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rfc822 = (day: string) => new Date(`${day}T00:00:00Z`).toUTCString()

/** An RSS 2.0 feed of every published post, newest first: the title and summary, linking to the page. */
export async function GET() {
  const posts = (await listPosts()).filter((p) => !p.draft)
  const items = posts
    .map((p) => {
      const url = `${site.url}/blog/${p.slug}`
      return `    <item>
      <title>${escape(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escape(p.description)}</description>
      <dc:creator>${escape(p.author)}</dc:creator>
      <pubDate>${rfc822(p.date)}</pubDate>
    </item>`
    })
    .join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escape(`${site.name} blog`)}</title>
    <link>${site.url}/blog</link>
    <atom:link href="${site.url}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>${escape(blogDescription)}</description>
    <language>en</language>${posts[0] ? `\n    <lastBuildDate>${rfc822(posts[0].date)}</lastBuildDate>` : ''}
${items}
  </channel>
</rss>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })
}
