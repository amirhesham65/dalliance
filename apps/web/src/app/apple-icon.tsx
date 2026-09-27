import { ImageResponse } from 'next/og'
import { MARK_SQUARES } from '@/lib/mark'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** The mark on paper, for home screens and bookmarks. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f6f3' }}>
        <svg width={96} height={112} viewBox="0 0 6 7" shapeRendering="crispEdges">
          {MARK_SQUARES.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#1d1d1b" />
          ))}
        </svg>
      </div>
    ),
    size,
  )
}
