'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const PROMPT = 'Survival by treatment arm, with a log-rank test'

// A two-arm trial: Kaplan-Meier survival as [month, survival] steps, and months where a patient was censored
type Arm = { label: string; stroke: string; swatch: string; steps: [number, number][]; censored: number[] }
const ARMS: Arm[] = [
  {
    label: 'Standard care',
    stroke: 'stroke-chart-1',
    swatch: 'before:bg-chart-1',
    steps: [[0, 1], [2, 0.95], [5, 0.88], [8, 0.81], [11, 0.74], [14, 0.67], [18, 0.6], [22, 0.5], [26, 0.43], [30, 0.37], [36, 0.3], [42, 0.25]],
    censored: [13, 27, 40, 46],
  },
  {
    label: 'New regimen',
    stroke: 'stroke-chart-top',
    swatch: 'before:bg-chart-top',
    steps: [[0, 1], [3, 0.97], [6, 0.93], [9, 0.9], [12, 0.85], [16, 0.8], [20, 0.74], [24, 0.68], [28, 0.6], [31, 0.5], [36, 0.44], [42, 0.39]],
    censored: [10, 19, 34, 45],
  },
]

// Chart space: months 0 to 48 across, survival 1 to 0 down
const MONTHS = 48
const x = (m: number) => 26 + (m / MONTHS) * 268
const y = (s: number) => 6 + (1 - s) * 92
const at = (arm: Arm, m: number) => arm.steps.filter(([sm]) => sm <= m).at(-1)![1]
const curve = (arm: Arm) => `M${x(0)},${y(1)}` + arm.steps.slice(1).map(([m, s]) => `H${x(m)}V${y(s)}`).join('') + `H${x(MONTHS)}`

const STEPS = ['Checking follow-up by arm', 'Comparing survival by arm']

type Phase = 'idle' | 'typing' | 'running' | 'done'

const reduceQuery = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(reduceQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * One Dalliance cell that plays through once when it comes into view: the prompt types itself, the agent
 * works, then the reading, the chart and the answer land. The Code tab shows what ran. With reduced
 * motion it starts finished.
 */
export function LiveCell() {
  const ref = useRef<HTMLElement>(null)
  // False on the server and with reduced motion, so the cell renders finished; true once a browser can animate it
  const motion = useSyncExternalStore(subscribeMotion, () => !window.matchMedia(reduceQuery).matches, () => false)
  const [phase, setPhase] = useState<Phase>('done')
  const [typed, setTyped] = useState(PROMPT.length)
  const [step, setStep] = useState(STEPS.length)
  const [tab, setTab] = useState<'result' | 'code'>('result')
  const [play, setPlay] = useState(0)

  const start = () => {
    setTab('result')
    setPhase('typing')
    setTyped(0)
    setStep(0)
    setPlay((p) => p + 1)
  }

  // Play once, the first time the cell is on screen
  useEffect(() => {
    const el = ref.current
    if (!motion || !el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        start()
      },
      { threshold: 0.5 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [motion])

  useEffect(() => {
    if (play === 0) return
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    let t = 350
    for (let i = 1; i <= PROMPT.length; i++) {
      at(t, () => setTyped(i))
      t += PROMPT[i - 1] === ' ' ? 70 : 38
    }
    at((t += 300), () => setPhase('running'))
    at((t += 650), () => setStep(1))
    at((t += 650), () => setStep(2))
    at((t += 250), () => setPhase('done'))
    return () => timers.forEach(clearTimeout)
  }, [play])

  // Before it plays, an animating cell waits empty with a blinking caret
  const waiting = motion && play === 0
  const shown = waiting ? 'idle' : phase
  const text = waiting ? '' : PROMPT.slice(0, typed)

  const count = shown === 'running' ? '[*]' : shown === 'done' ? '[1]' : '[ ]'

  return (
    <figure
      ref={ref}
      data-ready={motion || undefined}
      aria-label={`A Dalliance cell. The prompt "${PROMPT}" answered with Kaplan-Meier survival curves for two treatment arms and a log-rank test.`}
      // One cell drawn the way the app draws it. Stacked on narrow screens it keeps its desktop width, so the
      // chart's type does not scale up.
      className="flex w-full max-w-[520px] gap-2 rounded-xl border bg-card pt-4.5 pr-5 pb-5 pl-3.5 text-[14px] leading-[1.6] text-ink shadow-cell max-[480px]:pr-4"
    >
      <span className={`w-[30px] shrink-0 pt-0.5 font-mono text-[11px] ${shown === 'running' ? 'text-running' : 'text-ink-faint'}`} aria-hidden>
        {count}
      </span>
      <div className="min-w-0 flex-1">
        <p className="min-h-[1.6em] text-[15px]">
          <span data-rewind>{text}</span>
          {(shown === 'idle' || shown === 'typing') && <span className="ml-px inline-block h-[1.1em] w-[1.5px] bg-ink align-[-0.18em] motion-safe:animate-blink" aria-hidden />}
        </p>

        {/* The result keeps its space while the agent works, so nothing below the cell moves */}
        <div className="relative">
          {shown === 'running' && (
            <ul className="absolute inset-x-0 top-1.5 text-[13px] text-ink-subtle" aria-hidden>
              {STEPS.slice(0, step + 1).map((s, i) => (
                <li key={s} className="flex items-center gap-2 motion-safe:animate-rise">
                  {i < step ? (
                    <Check />
                  ) : (
                    <span className="inline-flex w-[13px] justify-center before:size-1.5 before:rounded-full before:bg-running before:content-[''] motion-safe:before:animate-throb" />
                  )}
                  {s}
                </li>
              ))}
            </ul>
          )}

          <div
            data-rewind
            data-show={shown === 'done' || undefined}
            className="group/result opacity-0 transition-opacity duration-240 ease-out data-show:opacity-100 motion-reduce:transition-none"
          >
            <p className="mt-1 text-[13px] text-ink-faint">
              Time to death, <Guess>censored at last visit</Guess>, compared with a <Guess>log-rank test</Guess>.
            </p>
            <div className="mt-3 flex items-center gap-3 text-[12px]" role="tablist" aria-label="Cell view">
              <button type="button" role="tab" className={tabClass} aria-selected={tab === 'result'} onClick={() => setTab('result')}>
                Result
              </button>
              <button type="button" role="tab" className={tabClass} aria-selected={tab === 'code'} onClick={() => setTab('code')}>
                Code
              </button>
              <span className="ml-auto font-mono text-[11px] text-ink-faint">4.2s</span>
              <button
                type="button"
                className="-my-[3px] -mr-[3px] inline-flex cursor-pointer rounded-sm p-[3px] text-ink-faint outline-none hover:bg-hairline hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                aria-label="Play the cell again"
                title="Play again"
                onClick={start}
              >
                <Replay />
              </button>
            </div>

            {/* Both views share one grid cell, so the card keeps the taller one's height on either tab. The
                inactive one keeps its space but is not shown, focusable or announced. */}
            <div className="mt-3 grid">
              <div className={`col-start-1 row-start-1 ${tab === 'result' ? '' : 'invisible'}`} role="tabpanel" aria-label="Result" inert={tab !== 'result'}>
                {/* Kaplan-Meier curves: step lines that draw themselves in, with censoring ticks */}
                <svg className="block h-auto w-full overflow-visible [&_text]:fill-ink-faint [&_text]:font-sans [&_text]:text-[8.5px]" viewBox="0 0 300 114" aria-hidden>
                  <line className="stroke-hairline" x1={x(0)} x2={x(MONTHS)} y1={y(0)} y2={y(0)} />
                  <line className="stroke-hairline [stroke-dasharray:2_3]" x1={x(0)} x2={x(MONTHS)} y1={y(0.5)} y2={y(0.5)} />
                  {[1, 0.5, 0].map((s) => (
                    <text key={s} x={20} y={y(s) + 3} textAnchor="end">
                      {s === 0 ? '0' : s.toFixed(1)}
                    </text>
                  ))}
                  {[0, 12, 24, 36, 48].map((m) => (
                    <text key={m} x={x(m)} y={112} textAnchor="middle">
                      {m === MONTHS ? '48 mo' : m}
                    </text>
                  ))}
                  {ARMS.map((arm, i) => (
                    <g key={arm.label} className={arm.stroke}>
                      {/* pathLength of 1 makes a dash of 1 the whole line, so the draw-in works on any curve */}
                      <path
                        className="fill-none stroke-[1.75] [stroke-dasharray:1] [stroke-linejoin:round] motion-safe:group-data-show/result:animate-draw"
                        d={curve(arm)}
                        pathLength={1}
                        style={{ animationDelay: `${i * 140}ms` }}
                      />
                      {arm.censored.map((m) => (
                        <path key={m} className="stroke-[1.25] motion-safe:group-data-show/result:animate-fade-late" d={`M${x(m)},${y(at(arm, m)) - 3}V${y(at(arm, m)) + 3}`} />
                      ))}
                    </g>
                  ))}
                </svg>
                <div className="mt-1.5 flex gap-4 pl-[26px] text-[11.5px] text-ink-subtle" aria-hidden>
                  {[...ARMS].reverse().map((arm) => (
                    <span key={arm.label} className={`inline-flex items-center gap-1.5 before:h-0.5 before:w-3 before:rounded-[1px] before:content-[''] ${arm.swatch}`}>
                      {arm.label}
                    </span>
                  ))}
                </div>
                <p className="mt-3 font-serif text-[16px] leading-[1.5]">
                  Median survival was <strong className="font-semibold">31 months</strong> on the new regimen and 22 on standard care, log-rank p = .003.
                </p>
              </div>
              {/* Code never breaks inside a word; a narrow screen scrolls the block instead */}
              <pre
                className={`col-start-1 row-start-1 overflow-x-auto rounded-lg bg-cell p-3 font-mono text-[11.5px] leading-[1.8] whitespace-pre text-ink max-[480px]:p-2.5 max-[480px]:text-[10.5px] ${tab === 'code' ? '' : 'invisible'}`}
                role="tabpanel"
                aria-label="Code"
                inert={tab !== 'code'}
              >
                <code>
                  km = <span className="text-code-f">KaplanMeierFitter</span>()
                  {'\n'}<span className="text-code-k">for</span> arm, g <span className="text-code-k">in</span> df.<span className="text-code-f">groupby</span>(<span className="text-code-s">&apos;arm&apos;</span>):
                  {'\n    '}km.<span className="text-code-f">fit</span>(g.months, g.died, label=arm)
                  {'\n    '}km.<span className="text-code-f">plot_survival_function</span>()
                  {'\n'}<span className="text-code-f">multivariate_logrank_test</span>(
                  {'\n    '}df.months, df.arm, df.died)
                </code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}

const tabClass =
  'cursor-pointer border-b-2 border-transparent pb-[3px] text-ink-faint outline-none hover:text-ink-subtle aria-selected:border-ink aria-selected:font-medium aria-selected:text-ink focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink'

/** An assumption the agent made, underlined the way the app marks one */
function Guess({ children }: { children: string }) {
  return <span className="border-b border-dashed border-ink-faint text-ink">{children}</span>
}

function Check() {
  return (
    <svg className="size-[13px] text-go" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function Replay() {
  return (
    <svg className="size-[13px]" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
