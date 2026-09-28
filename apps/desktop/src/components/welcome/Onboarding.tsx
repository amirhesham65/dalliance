import { ArrowRight, ArrowUpRight, Check, FilePlus, FolderOpen, Loader2, NotebookText } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PROVIDERS, keySourceText, providerForKey, saveKey } from '@/lib/keys'
import { sampleNotebook } from '@/lib/notebook/samples'
import { cn } from '@/lib/utils'
import type { DallianceApi, Provider, PythonState, SettingsView } from '@dalliance/shared/ipc'
import { actions, getApi, useNotebook, welcomeNotebook } from '@/store/notebook-store'
import { Kbd } from '@/components/ui/kbd'
import { StepBar, Wordmark } from './parts'
import { finishOnboarding, fresh, modKey, pythonReady, startWith } from './start'
import { usePythonSetup } from './use-python-setup'

const STEPS = ['Welcome', 'Model', 'Python', 'Start']

/**
 * The first run: what a cell is, a model key, a Python to run on, and a first notebook.
 * Every step can be skipped; Settings has the same controls later.
 */
export function Onboarding({ initialStep = 0, onClose }: { initialStep?: number; onClose: () => void }) {
  const settings = useNotebook((s) => s.settings)
  const python = useNotebook((s) => s.python)
  const [step, setStep] = useState(initialStep)
  const api = getApi()
  if (!settings || !api) return null

  const ready = [true, settings.keySource != null, pythonReady(python), true]
  const last = step === STEPS.length - 1
  const later = async () => {
    await finishOnboarding()
    onClose()
  }

  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 justify-center overflow-y-auto px-2 pb-2">
      <section aria-label="Set up Dalliance" className="my-auto flex w-full max-w-[620px] flex-col rounded-xl border bg-background shadow-pane">
        <header className="flex flex-col gap-5 px-8 pt-7 short:gap-3 short:pt-4">
          <div className="flex items-center justify-between">
            <Wordmark />
            <span className="eyebrow tabular-nums">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>
          <StepBar steps={STEPS} current={step} onSelect={setStep} />
        </header>

        {/* Every step takes the height of the tallest one, the intro, so the card holds still between steps */}
        <div className="grid px-8 py-8 short:py-4">
          {step !== 0 && (
            <div aria-hidden inert className="invisible col-start-1 row-start-1">
              <IntroStep />
            </div>
          )}
          <div key={step} className="col-start-1 row-start-1 duration-300 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
            {step === 0 && <IntroStep />}
            {step === 1 && <ModelStep settings={settings} api={api} />}
            {step === 2 && <PythonStep python={python} api={api} />}
            {step === 3 && <StartStep missing={[!ready[1] && 'a model key', !ready[2] && 'Python'].filter((m): m is string => !!m)} />}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t px-8 py-4 short:py-2.5">
          {step > 0 && (
            <Button variant="ghost" className="-ml-2.5 text-muted-foreground" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <button type="button" onClick={() => void later()} className="ml-auto text-[13px] text-faint hover:text-foreground">
            {last ? 'Go to the start page' : 'Set up later'}
          </button>
          {!last && (
            <Button variant={ready[step] ? 'default' : 'secondary'} className="ml-3" onClick={() => setStep(step + 1)}>
              {ready[step] ? 'Continue' : 'Skip for now'}
              {ready[step] && <ArrowRight />}
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
}

function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-2 short:mb-2.5 short:gap-1">
      <h1 className="font-serif text-[27px] short:text-[23px] leading-[1.2] font-medium tracking-[-0.015em] text-balance">{title}</h1>
      <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-muted-foreground">{children}</p>
    </div>
  )
}

function IntroStep() {
  return (
    <>
      <StepHeading title="Write what you want to know">
        Each cell in a Dalliance notebook is a sentence. An agent turns it into Python, runs it on this computer, checks the result, and keeps the code that worked.
      </StepHeading>
      <SampleCell />
      <ol className="mt-5 grid gap-3 short:mt-2.5 text-[13px] leading-[1.55] text-muted-foreground sm:grid-cols-3">
        <Point n={1}>Write a prompt, then press Shift+Enter.</Point>
        <Point n={2}>Click an underlined guess to fix it.</Point>
        <Point n={3}>The code is one tab away, and yours to edit.</Point>
      </ol>
    </>
  )
}

function Point({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="font-mono text-[11px] leading-[1.9] text-faint">{n}</span>
      <span>{children}</span>
    </li>
  )
}

const BARS = [
  { month: 'May', value: 24.3 },
  { month: 'Jun', value: 27.9 },
  { month: 'Jul', value: 26.1 },
  { month: 'Aug', value: 35.5 },
]

/** A finished cell, drawn the way the notebook draws one, to show the parts before there is a real one. */
function SampleCell() {
  const max = Math.max(...BARS.map((b) => b.value))
  return (
    <figure aria-label="An example cell" className="flex gap-2 rounded-lg border bg-raised/60 px-4 py-4 short:py-2.5">
      <span className="w-7 shrink-0 pt-[3px] font-mono text-[11px] text-faint">[2]</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-[1.6]">Revenue by month, as a bar chart</p>
        <p className="mt-1.5 text-[13px] leading-[1.7] text-faint short:mt-0.5">
          Revenue is <span className="assumption">total including tax</span>, grouped by <span className="assumption">order month</span>.
        </p>
        <div className="mt-3 flex items-center gap-3 text-[13px] short:mt-2">
          <span className="border-b-2 border-foreground pb-1 font-medium">Result</span>
          <span className="pb-1 text-faint">Code</span>
          <span className="ml-auto pb-1 font-mono text-[11px] text-faint tabular-nums">8.4s</span>
        </div>
        <div className="mt-3 flex h-[88px] gap-3 border-b border-border pl-1 short:mt-2 short:h-10" aria-hidden>
          {BARS.map((b, i) => (
            <div key={b.month} className="flex flex-1 flex-col items-center justify-end">
              <div
                className={cn('grow-up w-full max-w-10 rounded-t-[3px] bg-chart-1', i === BARS.length - 1 && 'bg-ink')}
                style={{ height: `${(b.value / max) * 85}%`, animationDelay: `${120 + i * 70}ms` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3 pl-1 text-[11px] text-faint">
          {BARS.map((b) => (
            <span key={b.month} className="flex-1 text-center">
              {b.month}
            </span>
          ))}
        </div>
        <p className="mt-3 font-serif text-[16px] leading-[1.6] short:mt-1.5 short:text-[15px]">
          August was the strongest month at <strong className="font-semibold">$35.5k</strong>, up 36% on July.
        </p>
      </div>
    </figure>
  )
}

function ModelStep({ settings, api }: { settings: SettingsView; api: DallianceApi }) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const provider = PROVIDERS[settings.provider]

  const update = async (u: Parameters<DallianceApi['updateSettings']>[0]) => {
    useNotebook.setState({ settings: await api.updateSettings(u) })
  }
  const change = (value: string) => {
    setKey(value)
    setError(null)
    // A pasted key says whose it is, so the provider follows it
    const detected = providerForKey(value)
    if (detected && detected !== settings.provider) void update({ provider: detected })
  }
  const save = async () => {
    if (!key.trim()) return
    setSaving(true)
    try {
      const saved = await saveKey(api, settings.provider, key)
      if (!saved.view) return setError(saved.error)
      useNotebook.setState({ settings: saved.view })
      setNote(saved.note)
      setKey('')
      setReplacing(false)
    } catch (err) {
      setError(`Couldn't save the key: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <StepHeading title="Connect a model">
        The agent needs an API key to write code. It is stored encrypted with your system keychain and only sent to the provider you choose.
      </StepHeading>

      <div role="radiogroup" aria-label="Model provider" className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
          const checked = settings.provider === p
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => {
                setReplacing(false)
                setError(null)
                setNote(null)
                void update({ provider: p })
              }}
              className={cn(
                'flex flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors',
                checked ? 'border-ink/70 bg-background ring-1 ring-ink/70' : 'hover:border-ring/70 hover:bg-hover/60',
              )}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                <span className={cn('flex size-3.5 items-center justify-center rounded-full border', checked ? 'border-ink' : 'border-ring')}>
                  {checked && <span className="size-1.5 rounded-full bg-ink" />}
                </span>
                {PROVIDERS[p].label}
                {settings.hasKey[p] && <span className="ml-auto text-xs font-normal text-faint">key saved</span>}
              </span>
              <span className="pl-5.5 text-[12.5px] leading-[1.5] text-muted-foreground">{PROVIDERS[p].blurb}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        {settings.keySource && !replacing ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-[13px]" role="status">
            <span className="flex size-4 items-center justify-center rounded-full bg-go text-background">
              <Check className="size-2.5" strokeWidth={3.5} />
            </span>
            <span className="flex-1">
              {keySourceText(settings)}
              {note && <span className="text-muted-foreground"> {note}</span>}
            </span>
            <button type="button" className="text-xs text-faint hover:text-foreground" onClick={() => setReplacing(true)}>
              {settings.keySource === 'settings' ? 'Replace' : 'Use a different key'}
            </button>
          </div>
        ) : (
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="flex items-baseline justify-between">
              <Label htmlFor="onboarding-key">{provider.keyLabel}</Label>
              <a href={provider.keysUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
                Get a key from {provider.keysSite}
                <ArrowUpRight className="size-3" />
              </a>
            </div>
            <div className="flex gap-2">
              <Input
                id="onboarding-key"
                type="password"
                autoComplete="off"
                autoFocus
                value={key}
                onChange={(e) => change(e.target.value)}
                placeholder={provider.placeholder}
                aria-invalid={error != null}
                aria-describedby="onboarding-key-help"
                className="font-mono text-xs"
              />
              <Button type="submit" variant="secondary" disabled={!key.trim() || saving}>
                {saving && <Loader2 className="animate-spin" />}
                {saving ? 'Checking…' : 'Save key'}
              </Button>
            </div>
            <p id="onboarding-key-help" className={cn('text-xs', error ? 'text-destructive' : 'text-faint')} role={error ? 'alert' : undefined}>
              {error ?? (
                <>
                  Paste either kind of key, and the provider follows it. Or export <span className="font-mono">{provider.env}</span> in your shell profile.
                </>
              )}
            </p>
          </form>
        )}
      </div>
    </>
  )
}

function PythonStep({ python, api }: { python: PythonState | null; api: DallianceApi }) {
  const { log, installing, error, setup } = usePythonSetup(api)
  const version = python?.version?.split('.').slice(0, 2).join('.')
  const ready = pythonReady(python)
  const status = !python
    ? 'Looking for Python…'
    : ready
      ? python.source === 'managed'
        ? `Python ${version} in the app's own environment, with pandas, NumPy and matplotlib.`
        : `Found Python ${version} on this computer, with pandas, NumPy and matplotlib.`
      : python.python
        ? `Found Python ${version}, but it is missing ${python.missingPackages.join(', ')}.`
        : 'No Python found on this computer yet.'

  return (
    <>
      <StepHeading title="Give it a Python to run on">
        Cells run in a Python process on this computer, next to your files. The agent reads what they print to check its work.
      </StepHeading>

      <div className="flex items-center gap-2.5 rounded-lg bg-raised px-3.5 py-3 text-[13px]" role="status">
        {ready ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-go text-background">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
        ) : (
          <span className={cn('size-2 shrink-0 rounded-full', python ? 'bg-warn' : 'bg-faint pulse')} />
        )}
        <span className="flex-1">{status}</span>
      </div>

      <div className="mt-4 flex flex-col divide-y rounded-lg border">
        <div className="flex items-center gap-4 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[13.5px] font-medium">
              A private environment
              {!ready && <span className="text-xs font-normal text-go">Recommended</span>}
            </p>
            <p className="text-[12.5px] leading-[1.5] text-muted-foreground">Made in the app's data folder with pandas, NumPy and matplotlib. Takes about a minute.</p>
          </div>
          <Button variant={ready ? 'outline' : 'default'} size="sm" disabled={installing} onClick={() => void setup()}>
            {installing && <Loader2 className="animate-spin" />}
            {installing ? 'Setting up…' : python?.managedEnvExists ? 'Update' : 'Set up'}
          </Button>
        </div>
        <div className="flex items-center gap-4 px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">Your own interpreter</p>
            <p className="text-[12.5px] leading-[1.5] text-muted-foreground">Point at a Python or virtual environment you already use.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => actions.openSettings('python')}>
            Choose in Settings
          </Button>
        </div>
      </div>

      {(installing || log.length > 0) && (
        <pre className="scrollbar-thin mt-3 max-h-28 overflow-auto rounded-md bg-raised p-2 font-mono text-[11px] text-faint">{log.slice(-40).join('\n')}</pre>
      )}
      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
    </>
  )
}

function StartStep({ missing }: { missing: string[] }) {
  const mod = modKey()
  const done = async (opened: Promise<boolean>) => {
    if (await opened) await finishOnboarding()
  }
  return (
    <>
      <StepHeading title={missing.length ? 'Almost there' : 'You’re set'}>
        {missing.length
          ? `You can look around now. Add ${missing.join(' and ')} in Settings before running a cell.`
          : 'Start with the sample to watch a notebook fill in, or bring your own.'}
      </StepHeading>
      <div className="flex flex-col gap-2">
        <Choice
          icon={<NotebookText />}
          title="Try the sample notebook"
          detail="Three prompts that make their own data. Press Run all."
          primary
          onClick={() => void done(startWith(fresh(sampleNotebook())))}
        />
        <Choice icon={<FilePlus />} title="Start a blank notebook" shortcut={`${mod}N`} onClick={() => void done(startWith(fresh(welcomeNotebook())))} />
        <Choice
          icon={<FolderOpen />}
          title="Open a notebook…"
          detail="Jupyter .ipynb files open too. The agent can read the files in the same folder."
          shortcut={`${mod}O`}
          onClick={() => void done(startWith(() => getApi()!.openNotebook()))}
        />
      </div>
    </>
  )
}

function Choice({ icon, title, detail, shortcut, primary, onClick }: { icon: ReactNode; title: string; detail?: string; shortcut?: string; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/choice flex items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors hover:border-ring/70 hover:bg-hover/60',
        primary && 'border-ink/70 ring-1 ring-ink/70 hover:border-ink hover:bg-background',
      )}
    >
      <span className={cn('mt-0.5 flex text-muted-foreground [&_svg]:size-4', primary && 'text-ink')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        {detail && <span className="block text-[12.5px] leading-[1.5] text-muted-foreground">{detail}</span>}
      </span>
      {shortcut ? (
        <span className="pt-0.5">
          <Kbd>{shortcut}</Kbd>
        </span>
      ) : (
        <ArrowRight className="mt-0.5 size-4 text-faint transition-transform group-hover/choice:translate-x-0.5 group-hover/choice:text-ink" />
      )}
    </button>
  )
}
