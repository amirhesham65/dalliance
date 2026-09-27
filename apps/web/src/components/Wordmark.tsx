import Link from 'next/link'

/**
 * The app's mark: a sun, half drawn in ink and half hatched, like a progress bar that is partly done.
 * Ilios is Greek for sun.
 */
export function Mark() {
  return (
    <span className="mark" aria-hidden>
      <span />
      <span className="hatch" />
    </span>
  )
}

export function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="Ilios home">
      <Mark />
      Ilios
    </Link>
  )
}
