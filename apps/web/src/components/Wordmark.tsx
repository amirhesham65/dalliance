import Link from 'next/link'
import { MARK_SQUARES } from '@/lib/mark'

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 6 7" shapeRendering="crispEdges" aria-hidden>
      {MARK_SQUARES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  )
}

export function Wordmark() {
  return (
    <Link className="wordmark" href="/" aria-label="Dalliance home">
      <Mark />
      Dalliance
    </Link>
  )
}
