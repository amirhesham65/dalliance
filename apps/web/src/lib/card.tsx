import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { site } from './site'

export const cardSize = { width: 1200, height: 630 }
export const cardAlt = `${site.name}, ${site.headline.toLowerCase()}. ${site.tagline}`

const font = (pkg: string, file: string) => readFile(join(process.cwd(), 'node_modules/@fontsource', pkg, 'files', file))

const ink = '#1f3b2d'
const hatch = (gap: number) => `repeating-linear-gradient(-45deg, #c9c8c2 0px, #c9c8c2 1.5px, transparent 1.5px, transparent ${gap}px)`

/** The social card: the site's masthead on warm paper, under the same hatched band. */
export async function socialCard() {
  const [serif, serifMedium, sans] = await Promise.all([
    font('source-serif-4', 'source-serif-4-latin-400-normal.woff'),
    font('source-serif-4', 'source-serif-4-latin-500-normal.woff'),
    font('inter', 'inter-latin-500-normal.woff'),
  ])
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f7f6f3', color: '#1d1d1b' }}>
        <div style={{ display: 'flex', height: 92, borderBottom: '2px solid #e7e6e2', backgroundImage: hatch(9) }} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '56px 80px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', width: 38, height: 38, borderRadius: 999, border: `3px solid ${ink}`, overflow: 'hidden' }}>
              <div style={{ width: '50%', height: '100%', background: ink }} />
              <div style={{ width: '50%', height: '100%', backgroundImage: hatch(6) }} />
            </div>
            <div style={{ fontFamily: 'Serif', fontWeight: 500, fontSize: 40, letterSpacing: '-0.015em' }}>Ilios</div>
          </div>
          <div style={{ marginTop: 44, fontFamily: 'Serif', fontWeight: 500, fontSize: 72, lineHeight: 1.08, letterSpacing: '-0.02em', maxWidth: 1000 }}>
            {site.headline}
          </div>
          <div style={{ marginTop: 24, fontFamily: 'Sans', fontSize: 28, lineHeight: 1.4, color: '#3f3e3a', maxWidth: 960 }}>{site.tagline}</div>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontFamily: 'Sans', fontSize: 24, color: '#6b6a65' }}>
            <span>For macOS · Python · .ipynb</span>
            <span>{site.url.replace(/^https?:\/\//, '')}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...cardSize,
      fonts: [
        { name: 'Serif', data: serif, weight: 400, style: 'normal' },
        { name: 'Serif', data: serifMedium, weight: 500, style: 'normal' },
        { name: 'Sans', data: sans, weight: 500, style: 'normal' },
      ],
    },
  )
}
