'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BarChart, SurvivalChart } from './charts'
import { type Counting, type Origin, ORIGINS, POPULATIONS, type Population, type Test, TESTS, data, formatP, populationText } from './data'
import { Python } from './Python'

/**
 * A working miniature of the app on the home page. It opens on a finished cell, and a visitor can correct the
 * agent's guesses, switch to the code, run the suggested next prompts and answer the agent's question, the way
 * the app does it. Nothing calls a model: every run is scripted, and every number comes from data.json.
 */

type Kind = 'survival' | 'hazards' | 'stopped'
type Step = { label: string; detail?: string; done: boolean }

interface Cell {
  id: string
  kind: Kind
  count: number | null
  phase: 'running' | 'asking' | 'done'
  steps: Step[]
  durationMs: number
  // How the survival cell was read. Each is an assumption a visitor can correct
  origin: Origin
  population: Population
  test: Test
  // The answer to the agent's question in the early stops cell
  counting: Counting | null
  /** A correction being run. It applies when the run ends, so the old result stays up, dimmed, until then. */
  pending: Partial<Pick<Cell, 'origin' | 'population' | 'test'>> | null
}

const PROMPTS: Record<Kind, string> = {
  survival: 'Survival by treatment arm from patients.csv, with a log-rank test',
  hazards: 'Hazard ratio for the new regimen, adjusted for age and stage',
  stopped: 'Which patients stopped treatment early, and why?',
}

const QUESTION = `${data.switched} patients switched arms after progression. Count them in the arm they were randomised to?`
const OPTIONS: { label: string; counting: Counting }[] = [
  { label: 'Yes, intention to treat', counting: 'intention to treat' },
  { label: 'No, per protocol', counting: 'per protocol' },
]

const first: Cell = { id: 'c1', kind: 'survival', count: 1, phase: 'done', steps: [], durationMs: 5870, origin: 'randomisation', population: 'all patients', test: 'log-rank test', counting: null, pending: null }

const reduceQuery = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(reduceQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function Demo() {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(reduceQuery).matches, () => false)
  const [cells, setCells] = useState<Cell[]>([first])
  const [selected, setSelected] = useState('c1')
  // Until the visitor does something, the first guess glows a little to say it can be clicked
  const [touched, setTouched] = useState(false)
  const runs = useRef(1)
  const timers = useRef<number[]>([])
  const frame = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // The notebook only scrolls once the visitor clicks into the window, so a wheel passing over it scrolls the page
  const [active, setActive] = useState(false)
  // A wheel over the window before that shows a short note saying how
  const [nudge, setNudge] = useState(false)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Clicking or tapping outside the window, or Escape, hands the wheel back to the page
  useEffect(() => {
    if (!active) return
    const outside = (e: PointerEvent) => {
      if (!frame.current?.contains(e.target as Node)) setActive(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [active])

  useEffect(() => {
    if (!nudge) return
    const timer = window.setTimeout(() => setNudge(false), 1600)
    return () => clearTimeout(timer)
  }, [nudge])

  const update = useCallback((id: string, change: Partial<Cell> | ((c: Cell) => Partial<Cell>)) => {
    setCells((all) => all.map((c) => (c.id === id ? { ...c, ...(typeof change === 'function' ? change(c) : change) } : c)))
  }, [])

  /** Brings a cell into view in the notebook. Code can scroll it whether or not the wheel can. */
  const scrollTo = useCallback(
    (id: string) => {
      requestAnimationFrame(() => {
        const box = scroller.current
        const el = box?.querySelector<HTMLElement>(`[data-cell="${id}"]`)
        if (box && el) box.scrollTo({ top: el.offsetTop - 20, behavior: reduced ? 'auto' : 'smooth' })
      })
    },
    [reduced],
  )

  /** Plays steps one after another, each running then done, then calls `then`. */
  const play = useCallback(
    (id: string, steps: Omit<Step, 'done'>[], then: () => void) => {
      const pace = reduced ? 40 : 700
      let t = reduced ? 0 : 250
      for (const s of steps) {
        timers.current.push(window.setTimeout(() => update(id, (c) => ({ steps: [...c.steps, { label: s.label, done: false }] })), t))
        t += pace
        // By label, since a cell that waited on a question already has steps before these
        timers.current.push(window.setTimeout(() => update(id, (c) => ({ steps: c.steps.map((x) => (x.label === s.label ? { ...x, detail: s.detail, done: true } : x)) })), t))
      }
      timers.current.push(window.setTimeout(then, t + (reduced ? 0 : 250)))
    },
    [reduced, update],
  )

  const finish = (id: string, durationMs: number) => {
    const count = ++runs.current
    update(id, (c) => ({ ...c.pending, pending: null, phase: 'done', count, durationMs }))
    setSelected(id)
  }

  /** A corrected guess reruns the survival cell, as a correction does in the app. */
  const correct = (id: string, change: Partial<Pick<Cell, 'origin' | 'population' | 'test'>>) => {
    setTouched(true)
    setSelected(id)
    update(id, { pending: change, phase: 'running', count: null, steps: [] })
    const [key, value] = Object.entries(change)[0] as [string, string]
    const step =
      key === 'origin'
        ? value === 'first dose'
          ? { label: 'Reading the dose dates', detail: `${data.patients} dose dates` }
          : { label: 'Measuring from randomisation' }
        : key === 'population'
          ? { label: value === 'all patients' ? 'Using every patient' : `Selecting ${value}`, detail: `${data.survival.randomisation[value as Population].n} patients` }
          : { label: `Switching to a ${value}` }
    play(id, [step, { label: 'Comparing survival by arm', detail: 'Ran in 1,180 ms' }], () => finish(id, 4310))
  }

  const steps: Record<Kind, Omit<Step, 'done'>[]> = {
    survival: [],
    hazards: [{ label: 'Checked variables' }, { label: 'Fitting a Cox model', detail: 'Ran in 384 ms' }],
    stopped: [{ label: 'Checked variables' }, { label: 'Checking who switched arms', detail: `${data.switched} switched` }],
  }

  /** Adds a cell for a scripted prompt and runs it, the way clicking a suggestion does. */
  const run = (kind: Kind) => {
    setTouched(true)
    const existing = cells.find((c) => c.kind === kind)
    if (existing) {
      setSelected(existing.id)
      scrollTo(existing.id)
      return
    }
    const id = `c${cells.length + 1}`
    setCells((all) => [...all, { ...first, id, kind, count: null, phase: 'running', steps: [] }])
    setSelected(id)
    scrollTo(id)
    play(id, steps[kind], () => (kind === 'stopped' ? update(id, { phase: 'asking' }) : finish(id, 4120)))
  }

  const answer = (id: string, counting: Counting) => {
    update(id, { phase: 'running', counting })
    play(id, [{ label: 'Counting early stops by reason', detail: 'Ran in 96 ms' }], () => finish(id, 6240))
  }

  const reset = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    runs.current = 1
    setCells([first])
    setSelected('c1')
    setTouched(false)
    scroller.current?.scrollTo({ top: 0 })
  }

  const busy = cells.some((c) => c.phase !== 'done')
  const ran = new Set(cells.map((c) => c.kind))
  const upToDate = cells.filter((c) => c.phase === 'done').length

  return (
    <div className="demo">
      <div className="flex items-baseline justify-between gap-4 pb-3 text-[13px] text-ink-subtle">
        <p>
          <span className="font-medium text-ink">Try it.</span> Click an underlined guess to change it, open the code, or run a suggested prompt.
        </p>
        <button type="button" onClick={reset} className="shrink-0 cursor-pointer text-ink-subtle underline decoration-ink-faint underline-offset-2 hover:text-ink hover:decoration-current">
          Start over
        </button>
      </div>

      {/* The app's window: its top bar, the sidebar, and the notebook */}
      <div
        ref={frame}
        onPointerDown={() => setActive(true)}
        // Tabbing in counts too, so the keyboard can scroll the notebook
        onFocus={() => setActive(true)}
        // A mouse leaving hands the wheel back. On a touch screen the finger lifting counts as leaving, so a tap
        // outside does it instead
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(false)}
        onWheel={() => {
          const box = scroller.current
          if (!active && box && box.scrollHeight > box.clientHeight) setNudge(true)
        }}
        className={`overflow-hidden rounded-xl bg-(--a-canvas) text-(--a-fg) shadow-frame transition-shadow duration-150 ${active ? 'ring-2 ring-ink/20' : ''}`}
      >
        <div className="flex h-10 items-center gap-2 px-3 text-[13px]">
          <span className="flex gap-1.5 pr-2" aria-hidden>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} className="size-3 rounded-full" style={{ background: c }} />
            ))}
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-(--a-bg) px-2 py-0.5 shadow-(--a-shadow)">
            <span className={`size-1.5 rounded-full ${busy ? 'bg-(--a-warn)' : 'bg-(--a-go)'}`} aria-hidden />
            Survival analysis
          </span>
          <span className="ml-auto text-(--a-muted)">
            Sonnet 5.5 <span className="text-(--a-faint)">· med</span>
          </span>
        </div>

        <div className="grid h-[600px] grid-cols-1 gap-2 px-2 pb-2 sm:h-[720px] lg:grid-cols-[256px_minmax(0,1fr)]">
          <aside className="hidden rounded-xl bg-(--a-bg) shadow-(--a-shadow) lg:flex" aria-label="Notebook overview">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="border-b border-(--a-border) p-4">
                <p className="text-[15px] font-semibold">Survival analysis</p>
                <p className="mt-1 flex items-center justify-between text-[12px] text-(--a-muted)">
                  REGIMEN-2 Trial
                  <span className="flex items-center gap-1">
                    <span className={`size-1.5 rounded-full ${busy ? 'bg-(--a-warn)' : 'bg-(--a-go)'}`} aria-hidden />
                    Python 3.12 · {busy ? 'busy' : 'idle'}
                  </span>
                </p>
                <div className="mt-3 flex h-2 gap-px overflow-hidden rounded-sm border border-(--a-ink)" aria-hidden>
                  {cells.map((c) => (
                    <span key={c.id} className={`flex-1 ${c.phase === 'done' ? 'bg-(--a-ink)' : 'demo-hatch'}`} />
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-(--a-muted)">
                  {upToDate} of {cells.length} {cells.length === 1 ? 'cell' : 'cells'} up to date.
                </p>
              </div>
              <div className="p-2">
                <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-(--a-faint) uppercase">Cells</p>
                <ul className="text-[13px]">
                  {cells.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(c.id)
                          scrollTo(c.id)
                        }}
                        className={`w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left ${selected === c.id ? 'bg-(--a-hover) text-(--a-fg)' : 'text-(--a-muted) hover:bg-(--a-hover)'}`}
                      >
                        {PROMPTS[c.kind]}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="mt-auto border-t border-(--a-border) p-3 text-[12.5px] text-(--a-muted)" aria-hidden>
                {['Brief', 'Variables & Environment', 'History', 'Files'].map((s) => (
                  <li key={s} className="px-1 py-1">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="relative flex min-h-0 flex-col rounded-xl bg-(--a-bg) shadow-(--a-shadow)" aria-label="Notebook">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--a-border) px-4 text-[13px]">
              <span className="font-medium">Notebook</span>
              <span className="text-(--a-faint)">
                {cells.length} {cells.length === 1 ? 'prompt' : 'prompts'}
              </span>
            </div>
            {/* The gutter is kept either way, so the text doesn't shift when the scroll bar comes and goes */}
            <div ref={scroller} className={`min-h-0 flex-1 [scrollbar-gutter:stable] ${active ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`}>
              <div className="mx-auto max-w-[680px] px-4 pt-6 pb-10 sm:pr-8 sm:pl-14">
                <h3 className="font-serif text-[24px] font-medium tracking-[-0.01em] sm:text-[28px]">Overall survival</h3>
                <p className="mt-1 max-w-[52ch] font-serif text-[15px] leading-[1.6] text-(--a-muted) sm:text-[16px]">
                  Does the <strong className="font-semibold text-(--a-fg)">new regimen</strong> extend survival over standard care once age and stage are accounted for?
                </p>
                <hr className="mt-5 border-(--a-border)" />
                {cells.map((c, i) => (
                  <CellView
                    key={c.id}
                    cell={c}
                    selected={selected === c.id}
                    hint={i === 0 && !touched}
                    suggestions={c.phase === 'done' && selected === c.id ? (['hazards', 'stopped'] as Kind[]).filter((k) => !ran.has(k)) : []}
                    onCorrect={(change) => correct(c.id, change)}
                    onRun={run}
                    onAnswer={(counting) => answer(c.id, counting)}
                    onTouch={() => setTouched(true)}
                  />
                ))}
                <NewPrompt onRun={run} ran={cells} onFound={(id) => scrollTo(id)} />
              </div>
            </div>
            <span
              aria-hidden
              className={`pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-(--a-fg) px-3 py-1.5 text-[12.5px] whitespace-nowrap text-(--a-bg) shadow-(--a-pop-shadow) transition-opacity duration-200 ${nudge ? 'opacity-100' : 'opacity-0'}`}
            >
              Click to scroll the notebook
            </span>
          </section>
        </div>
      </div>
    </div>
  )
}

function CellView({
  cell,
  selected,
  hint,
  suggestions,
  onCorrect,
  onRun,
  onAnswer,
  onTouch,
}: {
  cell: Cell
  selected: boolean
  hint: boolean
  suggestions: Kind[]
  onCorrect: (change: Partial<Pick<Cell, 'origin' | 'population' | 'test'>>) => void
  onRun: (kind: Kind) => void
  onAnswer: (counting: Counting) => void
  onTouch: () => void
}) {
  const [tab, setTab] = useState<'result' | 'code'>('result')
  const done = cell.phase === 'done'
  return (
    <article data-cell={cell.id} className={`relative mt-5 border-l pt-1 pb-2 pl-4 sm:-ml-4 ${selected ? 'border-(--a-ring)' : 'border-transparent'}`}>
      <span className={`absolute top-1.5 -left-10 hidden font-mono text-[11px] sm:block ${done ? 'text-(--a-faint)' : 'text-(--a-warn)'}`} aria-hidden>
        [{cell.count ?? (cell.phase === 'asking' ? ' ' : '*')}]
      </span>
      <p className="text-[15px] leading-[1.6]">{PROMPTS[cell.kind]}</p>

      {done && <Interpretation cell={cell} hint={hint} onCorrect={onCorrect} onTouch={onTouch} />}

      {!done && (
        <div className="mt-2 flex flex-col gap-2" aria-live="polite">
          <ol className="flex flex-col gap-1 text-[12.5px]">
            {cell.steps.map((s) => (
              <li key={s.label} className="demo-rise flex items-start gap-2">
                <span className="mt-[3px] w-3 shrink-0">{s.done ? <Check /> : <Spinner />}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={s.done ? 'text-(--a-faint)' : 'text-(--a-muted)'}>{s.label}</span>
                  {s.detail && <span className="font-mono text-[11.5px] text-(--a-faint)">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {cell.phase === 'asking' && (
            <div className="demo-rise flex flex-col gap-2 rounded-lg bg-(--a-raised) px-3 py-3" role="alertdialog" aria-label={QUESTION}>
              <p className="text-[14px]">{QUESTION}</p>
              <div className="flex flex-wrap gap-1.5">
                {OPTIONS.map((o) => (
                  <button key={o.label} type="button" onClick={() => onAnswer(o.counting)} className="h-7 cursor-pointer rounded-md bg-(--a-hover) px-2.5 text-[13px] hover:bg-(--a-border)">
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* A cell rerunning keeps its last result, dimmed, as the app does with an out of date cell */}
      {!done && cell.kind === 'survival' && (
        <div className="mt-3 opacity-40 transition-opacity" aria-hidden inert>
          <Result cell={cell} />
        </div>
      )}

      {done && (
        <div className="demo-fade mt-3">
          <div className="flex items-center gap-3 text-[12px]" role="tablist" aria-label="Cell view">
            {(['result', 'code'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t)
                  onTouch()
                }}
                className="cursor-pointer text-(--a-faint) capitalize hover:text-(--a-muted) aria-selected:text-(--a-fg)"
              >
                {t}
              </button>
            ))}
            <span className="ml-auto font-mono text-[11px] text-(--a-faint) tabular-nums">{(cell.durationMs / 1000).toFixed(1)}s</span>
          </div>
          {tab === 'result' ? (
            <div className="mt-2 flex flex-col gap-3" role="tabpanel" aria-label="Result">
              <Result cell={cell} />
              {suggestions.length > 0 && (
                <ul aria-label="Suggested next prompts" className="-mx-2 flex flex-col">
                  {suggestions.map((k) => (
                    <li key={k}>
                      <button
                        type="button"
                        onClick={() => onRun(k)}
                        className="group flex w-full cursor-pointer items-baseline gap-2.5 rounded-md px-2 py-1 text-left text-[13.5px] text-(--a-muted) hover:bg-(--a-hover) hover:text-(--a-fg)"
                      >
                        <span className="text-(--a-faint) transition-transform group-hover:translate-x-0.5 group-hover:text-(--a-ink)" aria-hidden>
                          →
                        </span>
                        {PROMPTS[k]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-(--a-raised) p-3 font-mono text-[12px] leading-[1.7] whitespace-pre" role="tabpanel" aria-label="Code">
              <Python code={codeFor(cell)} />
            </pre>
          )}
        </div>
      )}
    </article>
  )
}

/** How the agent read the prompt. The survival cell's guesses each have alternatives to switch to. */
function Interpretation({ cell, hint, onCorrect, onTouch }: { cell: Cell; hint: boolean; onCorrect: (change: Partial<Cell>) => void; onTouch: () => void }) {
  const guess = (text: string, options?: { label: string; pick: () => void; current: boolean }[], glow = false) => (
    <Guess text={text} options={options} glow={glow} onOpen={onTouch} />
  )
  let line: ReactNode
  if (cell.kind === 'survival') {
    line = (
      <>
        Survival is time to death from{' '}
        {guess(
          cell.origin,
          ORIGINS.map((o) => ({ label: o, current: o === cell.origin, pick: () => onCorrect({ origin: o }) })),
          hint,
        )}
        , in{' '}
        {guess(
          populationText(cell.population),
          POPULATIONS.map((p) => ({ label: populationText(p), current: p === cell.population, pick: () => onCorrect({ population: p }) })),
        )}
        , compared with a{' '}
        {guess(
          cell.test,
          TESTS.map((t) => ({ label: t, current: t === cell.test, pick: () => onCorrect({ test: t }) })),
        )}
        .
      </>
    )
  } else if (cell.kind === 'hazards') {
    line = (
      <>
        A {guess('Cox proportional hazards')} model, with {guess('standard care')} and {guess('stage I')} as the reference groups.
      </>
    )
  } else {
    line = <>Early stops counted {guess(cell.counting ?? 'intention to treat')}, as you answered.</>
  }
  return <p className="mt-1 max-w-[62ch] text-[13px] leading-[1.7] text-(--a-faint)">{line}</p>
}

/** One underlined guess. Clicking it offers what to read it as instead; in the app you type your own. */
function Guess({ text, options, glow, onOpen }: { text: string; options?: { label: string; pick: () => void; current: boolean }[]; glow: boolean; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <span ref={box} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((o) => !o)
          onOpen()
        }}
        className={`cursor-pointer border-b border-dashed border-(--a-ring) text-(--a-fg) hover:border-(--a-muted) ${glow ? 'demo-glow' : ''}`}
      >
        {text}
      </button>
      {open && (
        <span role="dialog" aria-label={`Change "${text}"`} className="demo-rise absolute top-full left-0 z-10 mt-1.5 flex w-60 flex-col rounded-lg bg-(--a-popover) p-1.5 text-[13px] text-(--a-fg) shadow-(--a-pop-shadow)">
          {options ? (
            <>
              <span className="px-2 pt-1 pb-1.5 text-[11.5px] text-(--a-faint)">Read it as</span>
              {options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={o.current}
                  onClick={() => {
                    setOpen(false)
                    o.pick()
                  }}
                  className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-(--a-hover) disabled:cursor-default disabled:text-(--a-faint) disabled:hover:bg-transparent"
                >
                  {o.label}
                  {o.current && <Check />}
                </button>
              ))}
              <span className="px-2 pt-1.5 pb-1 text-[11.5px] leading-[1.5] text-(--a-faint)">In Dalliance you type any correction, and the cell reruns with it.</span>
            </>
          ) : (
            <span className="px-2 py-1.5 leading-[1.5] text-(--a-muted)">In Dalliance you click a guess like this one, type what you meant, and the cell reruns with it. Try the first cell&apos;s guesses here.</span>
          )}
        </span>
      )}
    </span>
  )
}

function Result({ cell }: { cell: Cell }) {
  if (cell.kind === 'survival') {
    const s = data.survival[cell.origin][cell.population]
    const [a, b] = s.arms
    const p = s.p[cell.test]
    const test = cell.test.replace(' test', '')
    const where = cell.population === 'all patients' ? '' : ` in ${cell.population}`
    const answer =
      p < 0.05 ? (
        <>
          Median survival{where} was <b>{a.median} months</b> on the new regimen and <b>{b.median}</b> on standard care. The gap is significant, {test} <b>{formatP(p)}</b>.
        </>
      ) : (
        <>
          Median survival{where} was <b>{a.median} months</b> on the new regimen and <b>{b.median}</b> on standard care, but the gap isn&apos;t significant: {test} <b>{formatP(p)}</b>, with {s.n} patients.
        </>
      )
    return (
      <>
        <Answer>{answer}</Answer>
        <SurvivalChart
          key={`${cell.origin}${cell.population}`}
          arms={s.arms}
          title={`Overall survival by arm${cell.population === 'all patients' ? '' : `, ${cell.population}`}`}
          xLabel={`Months since ${cell.origin}`}
        />
        <Created items={[['patients', `${data.patients} × 10`]]} />
      </>
    )
  }
  if (cell.kind === 'hazards') {
    const h = data.hazards
    const [hr, lo, hi] = h.rows[0]
    return (
      <>
        <Answer>
          After adjusting for age and stage, the new regimen cut the hazard of death by <b>{Math.round((1 - hr) * 100)}%</b> (HR <b>{hr.toFixed(2)}</b>, 95% CI {lo.toFixed(2)} to {hi.toFixed(2)}).
        </Answer>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-(--a-border) text-left text-[12px] text-(--a-faint)">
                <th className="py-1.5 pr-3 font-normal" />
                {h.columns.map((c) => (
                  <th key={c} className="py-1.5 pl-3 text-right font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.rows.map((row, i) => (
                <tr key={h.index[i]} className="border-b border-(--a-border) last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-[12px] text-(--a-muted)">{h.index[i]}</td>
                  {row.map((v, j) => (
                    <td key={j} className="py-1.5 pl-3 text-right">
                      {/* As pandas prints a column rounded to 3 places */}
                      {v.toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Created items={[['cph', ''], ['hazards', '4 × 4']]} />
      </>
    )
  }
  const s = data.stopped[cell.counting ?? 'intention to treat']
  const totals = s.reasons.map((_, i) => Object.values(s.counts).reduce((sum, arm) => sum + arm[i], 0))
  const order = totals.map((n, i) => [n, i]).sort((x, y) => y[0] - x[0])
  return (
    <>
      <Answer>
        <b>{s.stopped} patients</b> ({Math.round((s.stopped / s.patients) * 100)}%) stopped early, most often for <b>{s.reasons[order[0][1]]}</b> ({order[0][0]}) and{' '}
        {s.reasons[order[1][1]]} ({order[1][0]}). Counted {cell.counting === 'per protocol' ? `per protocol, without the ${data.switched} who switched arms` : 'by intention to treat'}.
      </Answer>
      <BarChart
        key={cell.counting}
        title="Early stops by reason and arm"
        yLabel="Patients"
        categories={s.reasons}
        series={Object.entries(s.counts).map(([label, values]) => ({ label, values }))}
      />
      <Created items={[['stopped', `${s.stopped} × 10`]]} />
    </>
  )
}

function Answer({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] font-serif text-[16px] leading-[1.6] [&_b]:font-semibold">{children}</p>
}

function Created({ items }: { items: [string, string][] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-(--a-faint)">
      <span>Created</span>
      {items.map(([name, shape]) => (
        <span key={name}>
          <span className="font-mono text-(--a-ref)">{name}</span>
          {shape && <span className="ml-1.5 tabular-nums">{shape}</span>}
        </span>
      ))}
    </p>
  )
}

/** The empty cell at the end. The demo runs its own prompts; anything else points to the app. */
function NewPrompt({ onRun, ran, onFound }: { onRun: (kind: Kind) => void; ran: Cell[]; onFound: (id: string) => void }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState<ReactNode>(null)
  const submit = () => {
    const t = text.trim()
    if (!t) return
    const kind: Kind | null = /hazard|cox/i.test(t) ? 'hazards' : /stop|early|discontinu|drop.?out/i.test(t) ? 'stopped' : /surviv|kaplan|curve|log.?rank|median/i.test(t) ? 'survival' : null
    const existing = kind && ran.find((c) => c.kind === kind)
    if (existing) {
      setMessage(<>That one is cell [{existing.count ?? '*'}] above.</>)
      onFound(existing.id)
    } else if (kind) {
      setText('')
      setMessage(null)
      onRun(kind)
    } else {
      setMessage(
        <>
          This demo runs a few prompts about one trial. In Dalliance you ask anything about your own data.{' '}
          <a href="/download?from=demo" className="text-(--a-fg)">
            Download for macOS
          </a>
        </>,
      )
    }
  }
  return (
    <div className="mt-6 border-l border-transparent pl-4 sm:-ml-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="sr-only" htmlFor="demo-prompt">
          A new prompt
        </label>
        <input
          id="demo-prompt"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setMessage(null)
          }}
          placeholder="Describe what you want to compute. Enter to run."
          autoComplete="off"
          className="w-full bg-transparent text-[15px] leading-[1.6] outline-none placeholder:text-(--a-faint)"
        />
      </form>
      {message && <p className="demo-rise mt-1.5 text-[13px] text-(--a-muted)">{message}</p>}
    </div>
  )
}

/** The code the agent wrote for a cell, as it was read. */
function codeFor(cell: Cell): string {
  if (cell.kind === 'survival') {
    const lines = ['import matplotlib.pyplot as plt', 'import pandas as pd', 'from lifelines import KaplanMeierFitter', 'from lifelines.statistics import logrank_test', '', "patients = pd.read_csv('patients.csv')"]
    let data = 'patients'
    if (cell.population !== 'all patients') {
      lines.push(cell.population === 'patients over 65' ? 'cohort = patients[patients.age > 65]' : "cohort = patients[patients.stage == 'III']")
      data = 'cohort'
    }
    if (cell.origin === 'first dose') lines.push(`${data} = ${data}.assign(months=(${data}.months - ${data}.dose_delay_days / 30.44).clip(lower=0))`)
    lines.push(
      '',
      'fig, ax = plt.subplots(figsize=(7.4, 3.4))',
      `for arm, g in ${data}.groupby('arm'):`,
      `    KaplanMeierFitter(label=arm).fit(g.months, g.died).plot_survival_function(ax=ax, ci_show=False, show_censors=True)`,
      `ax.set(title='Overall survival by arm', xlabel='Months since ${cell.origin}', ylabel='Survival probability', xlim=(0, 48))`,
      '',
      `new, std = (${data}[${data}.arm == a] for a in ('New regimen', 'Standard care'))`,
      `logrank_test(new.months, std.months, new.died, std.died${cell.test === 'Wilcoxon test' ? ", weightings='wilcoxon'" : ''}).summary`,
    )
    return lines.join('\n')
  }
  if (cell.kind === 'hazards') {
    return [
      'from lifelines import CoxPHFitter',
      '',
      'model = patients.assign(',
      "    new_regimen=(patients.arm == 'New regimen').astype(int),",
      "    stage_II=(patients.stage == 'II').astype(int),",
      "    stage_III=(patients.stage == 'III').astype(int),",
      ")[['months', 'died', 'new_regimen', 'age', 'stage_II', 'stage_III']]",
      "cph = CoxPHFitter().fit(model, 'months', 'died')",
      "hazards = cph.summary[['exp(coef)', 'exp(coef) lower 95%', 'exp(coef) upper 95%', 'p']]",
      "hazards.columns = ['hazard_ratio', 'ci_lower', 'ci_upper', 'p']",
      'hazards.round(3)',
    ].join('\n')
  }
  const perProtocol = cell.counting === 'per protocol'
  return [
    perProtocol ? "stopped = patients[~patients.switched].query('stopped_early')" : "stopped = patients.query('stopped_early')",
    "counts = stopped.groupby(['reason', 'arm']).size().unstack(fill_value=0)",
    "counts.plot.bar(title='Early stops by reason and arm', xlabel='Reason', ylabel='Patients', rot=0)",
    'counts',
  ].join('\n')
}

function Check() {
  return (
    <svg className="size-3 text-(--a-go)" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="size-3 animate-spin text-(--a-muted) motion-reduce:animate-none" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  )
}
