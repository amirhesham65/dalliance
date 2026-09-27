'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const PROMPT = 'Survival by treatment arm, with a log-rank test'

// A two-arm trial: Kaplan-Meier survival as [month, survival] steps, and months where a patient was censored
type Arm = { label: string; className: string; steps: [number, number][]; censored: number[] }
const ARMS: Arm[] = [
  {
    label: 'Standard care',
    className: 'km-standard',
    steps: [[0, 1], [2, 0.95], [5, 0.88], [8, 0.81], [11, 0.74], [14, 0.67], [18, 0.6], [22, 0.5], [26, 0.43], [30, 0.37], [36, 0.3], [42, 0.25]],
    censored: [13, 27, 40, 46],
  },
  {
    label: 'New regimen',
    className: 'km-new',
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

const STEPS = ['Looked at df.head()', 'Ran the cell']

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
    <figure ref={ref} className="live-cell" data-ready={motion || undefined} aria-label={`A Dalliance cell. The prompt "${PROMPT}" answered with Kaplan-Meier survival curves for two treatment arms and a log-rank test.`}>
      <span className={shown === 'running' ? 'lc-count running' : 'lc-count'} aria-hidden>
        {count}
      </span>
      <div className="lc-body">
        <p className="lc-prompt">
          <span className="lc-typed">{text}</span>
          {(shown === 'idle' || shown === 'typing') && <span className="lc-caret" aria-hidden />}
        </p>

        <div className="lc-stage">
          {shown === 'running' && (
            <ul className="lc-activity" aria-hidden>
              {STEPS.slice(0, step + 1).map((s, i) => (
                <li key={s} className={i < step ? 'done' : 'running'}>
                  {i < step ? <Check /> : <span className="lc-dot" />}
                  {s}
                </li>
              ))}
            </ul>
          )}

          <div className="lc-result" data-show={shown === 'done' || undefined}>
            <p className="lc-reading">
              Time to death, <span className="assumption">censored at last visit</span>, compared with a <span className="assumption">log-rank test</span>.
            </p>
            <div className="lc-tabs" role="tablist" aria-label="Cell view">
              <button type="button" role="tab" aria-selected={tab === 'result'} onClick={() => setTab('result')}>
                Result
              </button>
              <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
                Code
              </button>
              <span className="lc-time">4.2s</span>
              <button type="button" className="lc-replay" aria-label="Play the cell again" title="Play again" onClick={start}>
                <Replay />
              </button>
            </div>

            {/* Both views share one grid cell, so the card keeps the taller one's height on either tab */}
            <div className="lc-views">
              <div className="lc-view" role="tabpanel" aria-label="Result" hidden={tab !== 'result'}>
                <svg className="km" viewBox="0 0 300 114" aria-hidden>
                  <line className="km-axis" x1={x(0)} x2={x(MONTHS)} y1={y(0)} y2={y(0)} />
                  <line className="km-median" x1={x(0)} x2={x(MONTHS)} y1={y(0.5)} y2={y(0.5)} />
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
                    <g key={arm.label} className={arm.className}>
                      <path className="km-line" d={curve(arm)} pathLength={1} style={{ animationDelay: `${i * 140}ms` }} />
                      {arm.censored.map((m) => (
                        <path key={m} className="km-tick" d={`M${x(m)},${y(at(arm, m)) - 3}V${y(at(arm, m)) + 3}`} />
                      ))}
                    </g>
                  ))}
                </svg>
                <div className="km-legend" aria-hidden>
                  {[...ARMS].reverse().map((arm) => (
                    <span key={arm.label} className={arm.className}>
                      {arm.label}
                    </span>
                  ))}
                </div>
                <p className="lc-answer">
                  Median survival was <strong>31 months</strong> on the new regimen and 22 on standard care, log-rank p = .003.
                </p>
              </div>
              <pre className="lc-view lc-code" role="tabpanel" aria-label="Code" hidden={tab !== 'code'}>
                <code>
                  km = <span className="f">KaplanMeierFitter</span>()
                  {'\n'}<span className="k">for</span> arm, g <span className="k">in</span> df.<span className="f">groupby</span>(<span className="s">&apos;arm&apos;</span>):
                  {'\n    '}km.<span className="f">fit</span>(g.months, g.died, label=arm)
                  {'\n    '}km.<span className="f">plot_survival_function</span>()
                  {'\n'}<span className="f">multivariate_logrank_test</span>(
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

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function Replay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
