import type { Metadata } from 'next'
import { Band, SiteFooter, SiteHeader } from '@/components/Chrome'
import { site } from '@/lib/site'
import { headline, labelMono, mastheadRuled, sheet, support } from '@/lib/ui'

const description = 'What this site counts, what Dalliance keeps on your Mac, and what it sends to your model provider.'

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
    rows: [
      { k: 'Page views.', v: 'Counted with Vercel Web Analytics: the page, the site that sent you, your country, browser, operating system and device type.' },
      { k: 'No cookies.', v: 'Nothing is stored on your device, and visits are not linked across days or other sites.' },
    ],
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
    rows: [{ k: 'None.', v: 'The app sends no analytics, crash reports or usage data.' }],
  },
]

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <div className={sheet}>
        <div className={mastheadRuled}>
          <p className={`${labelMono} mb-4`}>Updated 27 September 2026</p>
          <h1 className={headline}>Privacy</h1>
          <p className={support}>This site counts visits without cookies. The app keeps your work on your Mac and sends nothing about how you use it.</p>
        </div>
      </div>
      <main id="main" className={sheet}>
        {sections.map((s) => (
          <Band key={s.id} id={s.id} labelId={`${s.id}-h`} title={s.label}>
            {/* The band spaces consecutive paragraphs */}
            <div className="max-w-[62ch]">
              {s.rows.map((r) => (
                <p key={r.k}>
                  <span className="font-semibold text-ink">{r.k}</span> {r.v}
                </p>
              ))}
            </div>
          </Band>
        ))}
      </main>
      <SiteFooter />
    </>
  )
}
