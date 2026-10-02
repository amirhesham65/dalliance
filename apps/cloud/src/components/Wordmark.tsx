import { brand } from '@dalliance/brand/brand'
import { Mark } from '@dalliance/brand/Mark'
import { wordmark } from '@dalliance/brand/ui'

/** Links to the website, since this service has no home page of its own. */
export function Wordmark() {
  return (
    <a className={wordmark} href={brand.website} aria-label="Dalliance website">
      <Mark />
      Dalliance
    </a>
  )
}
