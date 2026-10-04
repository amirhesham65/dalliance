import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { feedAlternate } from '@/lib/blog'
import { site } from '@/lib/site'
import './globals.css'

// The app's three voices: Inter for the interface, Source Serif for the wordmark and answers, JetBrains Mono for code
const sans = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-source-serif', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  keywords: [...site.keywords],
  authors: [{ name: site.author }],
  creator: site.author,
  category: 'technology',
  alternates: { canonical: '/', types: feedAlternate },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: site.title,
    description: site.description,
    url: '/',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: site.title, description: site.description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
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
        {/* Cookieless page views, sent only from Vercel deployments, never in development */}
        <Analytics />
      </body>
    </html>
  )
}
