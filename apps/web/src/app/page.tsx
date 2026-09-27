import type { StaticImageData } from 'next/image'
import { getImageProps } from 'next/image'
import { Act, SiteFooter, SiteHeader } from '@/components/Chrome'
import { LiveCell } from '@/components/LiveCell'
import { type Frame, Reel } from '@/components/Reel'
import { site } from '@/lib/site'
import answerDark from '@/assets/shots/answer-dark.png'
import answerLight from '@/assets/shots/answer-light.png'
import askDark from '@/assets/shots/ask-dark.png'
import askLight from '@/assets/shots/ask-light.png'
import codeDark from '@/assets/shots/code-dark.png'
import codeLight from '@/assets/shots/code-light.png'
import guessDark from '@/assets/shots/guess-dark.png'
import guessLight from '@/assets/shots/guess-light.png'
import historyDark from '@/assets/shots/history-dark.png'
import historyLight from '@/assets/shots/history-light.png'
import modelsDark from '@/assets/shots/models-dark.png'
import modelsLight from '@/assets/shots/models-light.png'

const sizes = '(min-width: 1000px) 980px, 86vw'

/** A light and a dark capture of the same screen, resolved to one <picture> by the reel. */
function frame(label: string, alt: string, light: StaticImageData, dark: StaticImageData, first = false): Frame {
  const common = { alt, sizes, loading: first ? ('eager' as const) : ('lazy' as const) }
  const { props: darkProps } = getImageProps({ ...common, src: dark })
  const { props } = getImageProps({ ...common, src: light, fetchPriority: first ? 'high' : undefined })
  return { label, dark: darkProps.srcSet ?? '', img: props }
}

// In the order someone meets the features: ask, get asked back, correct, check the code, go back, switch models
const frames = [
  frame(
    'Ask in words',
    'A trial readout notebook. The cell "Median survival and 2-year survival by arm" shows the agent\'s reading of the prompt underlined, a one-line answer, the survival table and three suggested next prompts.',
    answerLight,
    answerDark,
    true,
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
    'The model picker, grouped by maker with a price for each model, and an effort setting below.',
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
    },
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
      screenshot: `${site.url}${answerLight.src}`,
      author: { '@type': 'Person', name: site.author },
      featureList: facts.map((f) => f.lead.replace(/\.$/, '')),
      fileFormat: 'application/x-ipynb+json',
    },
  ],
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <SiteHeader />
      <div className="sheet">
        <div className="masthead split gutter">
          <div>
            <h1>{site.headline}</h1>
            <p className="support">{site.tagline}</p>
            <Act />
          </div>
          <LiveCell />
        </div>
      </div>

      <main id="main">
        <Reel
          title="In short"
          intro="Ask a question in plain words. Ilios answers in a sentence and shows the table and the code behind it. When a prompt could mean two things, it asks you first."
          frames={frames}
        />

        <div className="sheet">
          <section className="band gutter" aria-labelledby="does">
            <h2 id="does">What it does</h2>
            <ol className="facts">
              {facts.map((f, i) => (
                <li className="fact" key={f.lead}>
                  <span className="num" aria-hidden>
                    [{i + 1}]
                  </span>
                  <span>
                    <strong>{f.lead}</strong> {f.body}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="band gutter" aria-labelledby="needs">
            <h2 id="needs">What it needs</h2>
            <div>
              <p>
                <strong>A Mac with Python 3.</strong> Ilios can create a private environment with pandas, NumPy and matplotlib, or use an interpreter you already have.
              </p>
              <p>
                <strong>A model key.</strong> Pick Claude, GPT, Gemini and more through the Vercel AI Gateway, or use the Anthropic API directly. Ilios keeps keys in the macOS Keychain.
              </p>
            </div>
          </section>

          <section className="band gutter" aria-labelledby="not">
            <h2 id="not">What it is not</h2>
            <div>
              <p>
                <strong>Not a chat.</strong> A chat answers once and scrolls away. Ilios keeps each answer next to its code, in a notebook you can rerun top to bottom.
              </p>
              <p>
                <strong>Not a black box.</strong> Every cell has a Code tab with the exact Python that ran. Notebooks save as standard .ipynb files and open in Jupyter.
              </p>
              <p>
                <strong>Not a cloud service.</strong> Your data, code and Python kernel stay on your Mac. Only your prompt and the context the agent reads go to your model provider.
              </p>
            </div>
          </section>

          <section className="band gutter" aria-labelledby="status">
            <h2 id="status">Status</h2>
            <div>
              <p>Ilios is an early preview, so expect rough edges. Your notebooks are plain .ipynb files, so nothing is locked in.</p>
            </div>
          </section>

          <div className="closing gutter">
            <p>Write the question. Keep the code.</p>
            <Act />
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  )
}
