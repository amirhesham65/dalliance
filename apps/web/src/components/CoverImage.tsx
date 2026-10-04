import { getImageProps } from 'next/image'
import type { Cover } from '@/lib/blog'

/**
 * A post's cover. The dark capture shows on a dark page, and only the one shown loads. By default it runs
 * across the sheet under a post's masthead, where it's the largest thing above the fold, so it loads first.
 */
export function CoverImage({
  cover,
  sizes = '(min-width: 1200px) 1200px, 100vw',
  eager = true,
  className = 'block border-b',
}: {
  cover: Cover
  sizes?: string
  eager?: boolean
  className?: string
}) {
  const common = { alt: cover.alt, sizes, ...(eager ? { loading: 'eager' as const, fetchPriority: 'high' as const } : { loading: 'lazy' as const }) }
  const { props } = getImageProps({ ...common, src: cover.light })
  const darkSrcSet = cover.dark ? getImageProps({ ...common, src: cover.dark }).props.srcSet : undefined
  return (
    <picture className={className}>
      {darkSrcSet && <source media="(prefers-color-scheme: dark)" srcSet={darkSrcSet} sizes={sizes} />}
      <img {...props} alt={cover.alt} className="block h-auto w-full" />
    </picture>
  )
}
