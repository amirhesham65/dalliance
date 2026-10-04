import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MDXContent } from 'mdx/types'
import type { StaticImageData } from 'next/image'
import { site } from './site'

/** What a post's frontmatter says about it, checked when the site builds. */
export type Post = {
  slug: string
  title: string
  description: string
  /** `YYYY-MM-DD`, the day it was published */
  date: string
  /** `YYYY-MM-DD`, the day it last changed in a way worth telling search engines. Defaults to `date` */
  updated: string
  author: string
  /** Shown by `next dev`, left out of production builds, the sitemap and the feed */
  draft: boolean
  cover: Cover | null
}

/** The image across the top of a post, from `export const cover` in its file. `dark` shows on a dark page. */
export type Cover = { light: StaticImageData; dark?: StaticImageData; alt: string }

const dir = join(process.cwd(), 'src/content/blog')
// Slugs become URLs and an import path, so they stay plain
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const showDrafts = process.env.NODE_ENV !== 'production'

/** A post's frontmatter and body, or null if there's no such post or it's a draft in production. */
export async function loadPost(slug: string): Promise<{ post: Post; Body: MDXContent } | null> {
  if (!SLUG.test(slug)) return null
  // Checked first, so a post that fails to compile fails the build instead of quietly disappearing
  const exists = await access(join(dir, `${slug}.mdx`)).then(() => true, () => false)
  if (!exists) return null
  const mod: { default: MDXContent; frontmatter?: unknown; cover?: unknown } = await import(`@/content/blog/${slug}.mdx`)
  const post = { ...readFrontmatter(slug, mod.frontmatter), cover: readCover(slug, mod.cover) }
  if (post.draft && !showDrafts) return null
  return { post, Body: mod.default }
}

/** Every published post, newest first. Drafts too under `next dev`. */
export async function listPosts(): Promise<Post[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mdx'))
  const posts = await Promise.all(
    files.map(async (f) => {
      const slug = f.slice(0, -'.mdx'.length)
      if (!SLUG.test(slug)) throw new Error(`Blog post ${f}: name it in lowercase words joined by hyphens, like first-post.mdx`)
      return (await loadPost(slug))?.post
    }),
  )
  return posts.filter((p) => p !== undefined).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

/** Fails the build with the file's name rather than rendering a post with a missing title or date. */
function readFrontmatter(slug: string, fm: unknown): Omit<Post, 'cover'> {
  const where = `Blog post ${slug}.mdx`
  if (!fm || typeof fm !== 'object') throw new Error(`${where} has no frontmatter. Start it with title, description and date between --- lines`)
  const { title, description, date, updated, author, draft } = fm as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim()) throw new Error(`${where} needs a title`)
  if (typeof description !== 'string' || !description.trim()) throw new Error(`${where} needs a description`)
  const day = readDay(date)
  if (!day) throw new Error(`${where} needs a date, as YYYY-MM-DD`)
  const changed = updated === undefined ? day : readDay(updated)
  if (!changed || changed < day) throw new Error(`${where}: updated must be a YYYY-MM-DD on or after date`)
  if (author !== undefined && typeof author !== 'string') throw new Error(`${where}: author must be text`)
  if (draft !== undefined && typeof draft !== 'boolean') throw new Error(`${where}: draft must be true or false`)
  return { slug, title: title.trim(), description: description.trim(), date: day, updated: changed, author: author?.trim() || site.author, draft: draft ?? false }
}

function readDay(value: unknown): string | null {
  // YAML reads an unquoted 2026-10-04 as a Date, so take either
  const day = value instanceof Date ? value.toISOString().slice(0, 10) : value
  return typeof day === 'string' && DATE.test(day) && !Number.isNaN(Date.parse(day)) ? day : null
}

/** What the blog is, for the index page and the feed */
export const blogDescription = `Notes on ${site.name}: what changed in each release, how it works, and why.`

/**
 * The feed, for `alternates.types` so readers and crawlers find it from any page. Metadata merges shallowly,
 * so every page that sets its own `alternates` spreads this in again.
 */
export const feedAlternate = { 'application/rss+xml': [{ url: '/blog/rss.xml', title: `${site.name} blog` }] }

function readCover(slug: string, cover: unknown): Cover | null {
  if (cover === undefined) return null
  const { light, dark, alt } = (cover ?? {}) as Record<string, unknown>
  const isImage = (v: unknown) => typeof v === 'object' && v !== null && 'src' in v && 'width' in v
  if (!isImage(light) || (dark !== undefined && !isImage(dark)) || typeof alt !== 'string' || !alt.trim())
    throw new Error(`Blog post ${slug}.mdx: cover needs imported images, as { light, dark, alt }, with alt text`)
  return { light: light as StaticImageData, dark: dark as StaticImageData | undefined, alt }
}

const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** `2026-10-04` as `4 October 2026`, the way the privacy page writes dates */
export function formatDate(day: string) {
  return longDate.format(new Date(`${day}T00:00:00Z`))
}
