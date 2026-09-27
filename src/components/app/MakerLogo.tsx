import { makerLogo } from '@/lib/makers'
import { cn } from '@/lib/utils'

/**
 * A model maker's logo in the text colour around it, so it follows the theme like an icon.
 * Makers without a logo get their initial.
 */
export function MakerLogo({ maker, className }: { maker: string; className?: string }) {
  const url = makerLogo(maker)
  if (!url)
    return (
      <span aria-hidden className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-hover text-[9px] leading-none font-semibold uppercase', className)}>
        {maker.charAt(0)}
      </span>
    )
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3.5 shrink-0 bg-current', className)}
      style={{ maskImage: `url("${url}")`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }}
    />
  )
}
