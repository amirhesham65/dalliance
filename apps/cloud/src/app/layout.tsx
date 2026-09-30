import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import { site } from '@/lib/site'
import './globals.css'

// The app's three voices: Inter for the interface, Source Serif for the wordmark and headlines, JetBrains Mono for codes
const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-source-serif', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
  applicationName: site.name,
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: site.paper.light },
    { media: '(prefers-color-scheme: dark)', color: site.paper.dark },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <a className="absolute -top-12 left-3 z-10 rounded-lg bg-brand px-3 py-1.5 text-on-brand no-underline focus:top-3" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
