import { getImageProps, type StaticImageData } from 'next/image'

/**
 * A screenshot in a blog post, framed like the reel's. Pass `dark` too and a dark page shows the dark
 * capture; the browser fetches only the one it shows. Import the files at the top of the post:
 *
 *   import answer from '@/assets/shots/answer-light.png'
 *   <Figure src={answer} alt="…" caption="…" />
 */
export function Figure({ src, dark, alt, caption }: { src: StaticImageData; dark?: StaticImageData; alt: string; caption?: string }) {
  const common = { alt, sizes: '(min-width: 1000px) 640px, 92vw' }
  const { props } = getImageProps({ ...common, src })
  const darkSrcSet = dark ? getImageProps({ ...common, src: dark }).props.srcSet : undefined
  return (
    <figure className="mt-8 first:mt-0">
      <picture>
        {darkSrcSet && <source media="(prefers-color-scheme: dark)" srcSet={darkSrcSet} sizes={common.sizes} />}
        <img {...props} alt={alt} loading="lazy" decoding="async" className="block h-auto w-full rounded-lg shadow-frame" />
      </picture>
      {caption && <figcaption className="mt-3 text-[13px] text-ink-subtle">{caption}</figcaption>}
    </figure>
  )
}
