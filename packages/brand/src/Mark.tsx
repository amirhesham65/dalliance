import { MARK_SQUARES } from './mark'

export function Mark() {
  return (
    // 17.5px keeps each of the seven rows on whole device pixels on Retina screens
    <svg className="block h-[17.5px] w-auto shrink-0 fill-current" viewBox="0 0 6 7" shapeRendering="crispEdges" aria-hidden>
      {MARK_SQUARES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  )
}
