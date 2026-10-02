import Link from 'next/link'
import { Mark } from '@dalliance/brand/Mark'
import { wordmark } from '@dalliance/brand/ui'

export function Wordmark() {
  return (
    <Link className={wordmark} href="/" aria-label="Dalliance home">
      <Mark />
      Dalliance
    </Link>
  )
}
