import Link from 'next/link'
import { formatDate, type Post } from '@/lib/blog'
import { labelMono } from '@dalliance/brand/ui'
import { Band } from './Chrome'
import { CoverImage } from './CoverImage'

/** The newest posts on the home page, the first with its cover. Nothing when there are none. */
export function LatestPosts({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null
  return (
    <Band title="From the blog" labelId="blog">
      <div>
        <ul className="space-y-10">
          {posts.map((p, i) => (
            <li key={p.slug} className="max-w-[720px]">
              {i === 0 && p.cover && (
                // The title is the link for keyboards and screen readers; the cover is a bigger target for a mouse
                <Link href={`/blog/${p.slug}`} tabIndex={-1} aria-hidden className="mb-5 block overflow-hidden rounded-lg shadow-frame">
                  <CoverImage cover={p.cover} sizes="(min-width: 1000px) 720px, 92vw" eager={false} className="block" />
                </Link>
              )}
              <p className={labelMono}>
                <time dateTime={p.date}>{formatDate(p.date)}</time>
              </p>
              <h3 className="mt-2 font-serif text-[24px] leading-[1.25] font-medium tracking-[-0.01em] text-balance text-ink">
                <Link href={`/blog/${p.slug}`} className="no-underline hover:underline">
                  {p.title}
                </Link>
              </h3>
              <p className="mt-2 text-pretty">{p.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-8">
          <Link href="/blog">All posts</Link>
        </p>
      </div>
    </Band>
  )
}
