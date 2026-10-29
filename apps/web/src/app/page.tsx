import type { StaticImageData } from 'next/image'
import { getImageProps } from 'next/image'
import { Act, Band, SiteFooter, SiteHeader } from '@/components/Chrome'
import { Demo } from '@/components/demo/Demo'
import { AppsFeature } from '@/components/AppsFeature'
import { LatestPosts } from '@/components/LatestPosts'
import { type Frame, Reel } from '@/components/Reel'
import { listPosts } from '@/lib/blog'
import { jsonLdScript, publisher } from '@/lib/seo'
import { site } from '@/lib/site'
import { gutter, headline, label, sheet, support } from '@dalliance/brand/ui'
import answerDark from '@/assets/shots/answer-dark.png'
import answerLight from '@/assets/shots/answer-light.png'
import askDark from '@/assets/shots/ask-dark.png'
import askLight from '@/assets/shots/ask-light.png'
import codeDark from '@/assets/shots/code-dark.png'
import codeLight from '@/assets/shots/code-light.png'
import guessDark from '@/assets/shots/guess-dark.png'
import guessLight from '@/assets/shots/guess-light.png'
import heroLight from '@/assets/shots/hero-light.png'
import historyDark from '@/assets/shots/history-dark.png'
import historyLight from '@/assets/shots/history-light.png'
import modelsDark from '@/assets/shots/models-dark.png'
import modelsLight from '@/assets/shots/models-light.png'

const sizes = '(min-width: 1000px) 980px, 86vw'

/** A light and a dark capture of the same screen, resolved to one <picture> by the reel. */
function frame(label: string, alt: string, light: StaticImageData, dark: StaticImageData): Frame {
  const common = { alt, sizes, loading: 'lazy' as const }
  const { props: darkProps } = getImageProps({ ...common, src: dark })
  const { props } = getImageProps({ ...common, src: light })
  return { label, dark: darkProps.srcSet ?? '', img: props }
}


// In the order someone meets the features: ask, get asked back, correct, check the code, go back, switch models
const frames = [
  frame(
    'Ask in words',
    'A trial readout notebook. The cell "Median survival and 2-year survival by arm" shows the agent\'s reading of the prompt underlined, a one-line answer, the survival table and three suggested next prompts.',
    answerLight,
    answerDark,
  ),
  frame(
    'It asks first',
    'A cell mid-run. The agent found 38 patients who switched arms and asks whether to count them by intention to treat or per protocol before it writes any code.',
    askLight,
    askDark,
  ),
  frame(
    'Fix a guess',
    'Correcting an underlined assumption in place, measuring survival from first dose instead of randomisation. The next run uses the correction.',
    guessLight,
    guessDark,
  ),
  frame('Read the code', 'The Code tab of a cell, with the Kaplan-Meier code the agent wrote and ran.', codeLight, codeDark),
  frame(
    'Go back',
    'The History pane beside the notebook. An earlier version took a plain median that ignored censoring; the current one uses Kaplan-Meier.',
    historyLight,
    historyDark,
  ),
  frame(
    'Any model',
    'The model picker, grouped by maker, with an effort setting below.',
    modelsLight,
    modelsDark,
  ),
]

const facts = [
  { lead: 'Runs and checks.', body: 'The agent runs the code, reads the output or the error, and retries until the cell works. Failed code never lands in your notebook.' },
  { lead: 'Shows its guesses.', body: 'Under each prompt it writes how it read it, with every assumption underlined. Click one to correct it and the next run uses your version.' },
  { lead: 'Asks when it matters.', body: 'If a wrong guess would change the result, it checks the data and asks you before writing code.' },
  { lead: 'Keeps the code.', body: 'An unchanged cell reruns its saved code directly, with no model call. Edit the code yourself and your version stays.' },
  { lead: 'Keeps every version.', body: "Each new version of a cell's code is saved. Restore any of them in a click." },
  { lead: 'Reads your brief.', body: 'Put notes like "months are from randomisation, not diagnosis" in AGENTS.md and the agent follows them in every cell.' },
]

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${site.url}/#website`,
      url: `${site.url}/`,
      name: site.name,
      description: site.description,
      inLanguage: 'en',
      publisher: { '@id': publisher['@id'] },
    },
    publisher,
    {
      '@type': 'SoftwareApplication',
      '@id': `${site.url}/#app`,
      name: site.name,
      description: site.description,
      url: `${site.url}/`,
      applicationCategory: 'DeveloperApplication',
      applicationSubCategory: 'Data analysis notebook',
      operatingSystem: 'macOS',
      downloadUrl: `${site.url}/download`,
      screenshot: `${site.url}${heroLight.src}`,
      author: { '@type': 'Person', name: site.author },
      publisher: { '@id': publisher['@id'] },
      featureList: facts.map((f) => f.lead.replace(/\.$/, '')),
      fileFormat: 'application/x-ipynb+json',
    },
  ],
}

export default async function Home() {
  const posts = (await listPosts()).filter((p) => !p.draft).slice(0, 3)
  return (
    <>
      {jsonLdScript(jsonLd)}

      <SiteHeader />
      <div className={sheet}>
        {/* Centred type over a working miniature of the app */}
        <div className={`${gutter} pt-16 lg:pt-24`}>
          <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
            <p className={label}>{site.status}</p>
            {/* Hyphenated words stay whole: a line ending in "Open-" reads like a typo */}
            <h1 className={`${headline} mx-auto mt-5 lg:text-[62px]`}>
              {site.headline.split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}
            </h1>
            <p className={`${support} mx-auto`}>{site.tagline}</p>
            <Act from="hero" centred />
          </div>
          {/* The app itself, working: correct a guess, read the code, run the next prompt */}
          <div className="mt-12 pb-14 lg:mt-16 lg:pb-20">
            <Demo />
          </div>
        </div>
      </div>

      <main id="main">
        <Reel
          title="In short"
          intro="Ask a question in plain words. Dalliance answers in a sentence and shows the table and the code behind it. When a prompt could mean two things, it asks you first."
          frames={frames}
        />

        <div className={sheet}>
          <Band title="Apps" id="apps" labelId="apps-heading">
            <AppsFeature />
          </Band>
          <Band title="What it does" labelId="does">
            {/* Numbered like notebook cells, hanging into the margin so the prose starts on the same line as every other band's */}
            <ol className="space-y-4 lg:-ml-10">
              {facts.map((f, i) => (
                <li className="grid max-w-[calc(62ch+40px)] grid-cols-[32px_1fr] gap-2" key={f.lead}>
                  <span className="font-mono text-[12px] leading-[25px] text-ink-faint tabular-nums" aria-hidden>
                    [{i + 1}]
                  </span>
                  <span>
                    <strong>{f.lead}</strong> {f.body}
                  </span>
                </li>
              ))}
            </ol>
          </Band>

          <Band title="What it needs" labelId="needs">
            <div>
              <p>
                <strong>A Mac with Python.</strong> Notebook cells need Python 3.9 or newer. Apps use a separate environment with a compatible installed Python 3.11 or newer. Dalliance can create a private notebook environment with pandas, NumPy and matplotlib, or use an interpreter you already have.
              </p>
              <p>
                <strong>Open source. Your own API key.</strong> Connect Anthropic, Google, or OpenAI. Requests go directly to your provider, and you pay for your own API usage.
              </p>
            </div>
          </Band>

          <Band title="What it is not" labelId="not">
            <div>
              <p>
                <strong>Not a chat.</strong> A chat answers once and scrolls away. Dalliance keeps each answer next to its code, in a notebook you can rerun top to bottom.
              </p>
              <p>
                <strong>Not a black box.</strong> Every cell has a Code tab with the exact Python that ran. Notebooks save as standard .ipynb files and open in Jupyter.
              </p>
              <p>
                <strong>Python runs locally.</strong> Your notebooks and Python kernel stay on your Mac. Your prompt and the context the agent reads go directly to your chosen provider, under your account's data policies.
              </p>
            </div>
          </Band>

          <Band title="Status" labelId="status">
            <div>
              <p>Dalliance is an early preview, so expect rough edges. Your notebooks are plain .ipynb files, so nothing is locked in.</p>
            </div>
          </Band>

          <LatestPosts posts={posts} />

          <div className={`${gutter} border-b py-14 lg:py-22`}>
            <p className="max-w-[30ch] font-serif text-[30px] leading-[1.3] font-medium tracking-[-0.02em] text-ink lg:text-[40px]">Write the question. Keep the code.</p>
            <Act from="end" />
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  )
}
