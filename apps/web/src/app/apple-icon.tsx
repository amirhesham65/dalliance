import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

const ink = '#1f3b2d'

/** The mark on paper, for home screens and bookmarks. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f6f3' }}>
        <div style={{ display: 'flex', width: 112, height: 112, borderRadius: 999, border: `7px solid ${ink}`, overflow: 'hidden' }}>
          <div style={{ width: '50%', height: '100%', background: ink }} />
          <div
            style={{
              width: '50%',
              height: '100%',
              backgroundImage: 'repeating-linear-gradient(-45deg, #9faea4 0px, #9faea4 3px, transparent 3px, transparent 10px)',
            }}
          />
        </div>
      </div>
    ),
    size,
  )
}
