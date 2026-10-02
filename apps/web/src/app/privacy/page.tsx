import type { Metadata } from 'next'
import { Band, SiteFooter, SiteHeader } from '@/components/Chrome'
import { site } from '@/lib/site'
import { headline, labelMono, mastheadRuled, sheet, support } from '@dalliance/brand/ui'

const description = 'What this site counts, what Dalliance keeps on your Mac, what your account holds, and what goes to the model.'

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
      { k: 'Downloads.', v: 'Each click on a download button is logged with the time, the button, the page it was on, your country, region and city, browser, operating system and device type. Not your IP address. Only the latest 10,000 downloads are kept.' },
      { k: 'No cookies.', v: 'Nothing is stored on your device, and visits are not linked across days or other sites.' },
    ],
  },
  {
    id: 'local',
    label: 'On your Mac',
    rows: [
      { k: 'Your work.', v: 'Notebooks, data and code stay local. Python runs on your Mac.' },
      { k: 'Sign-in.', v: 'Your session is encrypted with the macOS Keychain and stays in the app.' },
      { k: 'Logs.', v: 'Kept in the app data folder. Never uploaded.' },
    ],
  },
  {
    id: 'account',
    label: 'Your account',
    rows: [
      { k: 'Who you are.', v: 'Your name and email, from Google when you sign in.' },
      { k: 'Your plan.', v: 'Polar handles checkout, payment and invoices as the merchant of record. Dalliance keeps your subscription and never sees your card.' },
      { k: 'Usage.', v: 'For each model call: when it ran, the model, and what it cost in credits. Never the prompt or the answer.' },
    ],
  },
  {
    id: 'model',
    label: 'Model requests',
    rows: [
      { k: 'What is sent.', v: 'Your prompt and the context the agent reads for it, such as variable names, data previews, outputs and files in the notebook folder.' },
      { k: 'Where.', v: "Through Dalliance Cloud to Vercel AI Gateway, which sends it to the model's provider. Every call runs with zero data retention, so the provider doesn't keep it, and Dalliance doesn't log it." },
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
          <p className={`${labelMono} mb-4`}>Updated 2 October 2026</p>
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
