import type { Metadata } from 'next'
import { SiteFooter, SiteHeader } from '@/components/Chrome'
import { site } from '@/lib/site'

const description = 'What Ilios keeps on your Mac and what it sends to your model provider.'

export const metadata: Metadata = {
  title: 'Privacy',
  description,
  alternates: { canonical: '/privacy' },
  // Metadata merges shallowly, so the page restates the whole Open Graph block rather than only the url
  openGraph: { type: 'website', siteName: site.name, locale: 'en_US', title: `Privacy · ${site.name}`, description, url: '/privacy' },
  twitter: { card: 'summary_large_image', title: `Privacy · ${site.name}`, description },
}

const sections = [
  {
    id: 'site',
    label: 'This website',
    rows: [{ k: 'No tracking.', v: 'No cookies, analytics or third-party scripts.' }],
  },
  {
    id: 'local',
    label: 'On your Mac',
    rows: [
      { k: 'Your work.', v: 'Notebooks, data and code stay local. Python runs on your Mac.' },
      { k: 'Keys.', v: 'Encrypted in the macOS Keychain. Sent only to their provider.' },
      { k: 'Logs.', v: 'Kept in the app data folder. Never uploaded.' },
    ],
  },
  {
    id: 'model',
    label: 'Model requests',
    rows: [
      { k: 'What is sent.', v: 'Your prompt and the context the agent reads for it, such as variable names, data previews, outputs and files in the notebook folder.' },
      { k: 'Where.', v: "Only to the provider you choose in Settings, under your own key. That provider's terms cover what it receives." },
      { k: 'Reruns.', v: 'Unchanged cells never call the model.' },
      { k: 'Titles.', v: 'A small model names each cell. You can turn this off.' },
      { k: '.env files.', v: "The agent's file reader skips them. Code it runs can still open them." },
    ],
  },
  {
    id: 'telemetry',
    label: 'Telemetry',
    rows: [{ k: 'None.', v: 'No analytics, crash reports or usage tracking.' }],
  },
]

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <div className="sheet">
        <div className="masthead ruled gutter">
          <p className="eyebrow meta">Updated 27 September 2026</p>
          <h1>Privacy</h1>
          <p className="support">This site collects nothing. The app keeps your work on your Mac.</p>
        </div>
      </div>
      <main id="main" className="sheet">
        {sections.map((s) => (
          <section className="band gutter" id={s.id} key={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>{s.label}</h2>
            <div className="rows">
              {s.rows.map((r) => (
                <div className="row" key={r.k}>
                  <p>
                    <span className="k">{r.k}</span> {r.v}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  )
}
