'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { focusRing } from '@dalliance/brand/ui'
import type { GenerationRun } from '@/vendor/transitions/ui-generation'

const cohorts = {
  all: { label: 'All groups', records: 24, scores: [48.5, 40.5, 35.5] },
  treatment: { label: 'Treatment', records: 12, scores: [49, 36, 28] },
  control: { label: 'Control', records: 12, scores: [48, 45, 43] },
} as const
type Cohort = keyof typeof cohorts

/** An illustrative app with local controls. The reveal measures the actual rendered panel. */
export function AppsFeature() {
  const [cohort, setCohort] = useState<Cohort>('all')
  const [building, setBuilding] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const lifecycle = useRef<{ generation: number; animation: GenerationRun | null; hasPlayed: boolean }>({ generation: 0, animation: null, hasPlayed: false })
  const selectId = useId()
  const data = cohorts[cohort]

  const cancel = useCallback(() => {
    const active = lifecycle.current
    active.generation++
    active.animation?.cancel()
    active.animation = null
    setBuilding(false)
  }, [])

  const reveal = useCallback(async () => {
    const active = lifecycle.current
    active.hasPlayed = true
    const current = ++active.generation
    setBuilding(true)
    try {
      await document.fonts.ready
      const { generate } = await import('@/vendor/transitions/ui-generation.js')
      if (active.generation !== current || !panel.current) return
      active.animation?.cancel()
      const run = generate(panel.current, { mode: 'skeleton', maxParts: 28, keys: 3 })
      active.animation = run
      await run.finished
    } finally {
      if (active.generation === current) {
        active.animation = null
        setBuilding(false)
      }
    }
  }, [])

  useEffect(() => {
    const active = lifecycle.current
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.25 && !active.hasPlayed) {
        observer.disconnect()
        void reveal().catch(cancel)
      }
    }, { threshold: 0.25 })
    if (panel.current) observer.observe(panel.current)
    // Its overlay uses document coordinates and follows page scrolling. Resize changes its geometry.
    window.addEventListener('resize', cancel)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', cancel)
      active.generation++
      active.animation?.cancel()
    }
  }, [cancel, reveal])

  return (
    <div className="min-w-0 max-w-[680px]">
      <h3 className="font-serif text-[30px] leading-[1.2] font-medium tracking-[-0.025em] sm:text-[38px]">Turn your analysis into an app.</h3>
      <p className="mt-4">Describe what you want to explore. Dalliance builds an interactive app from your notebook data and opens it inside your project. The Python code is yours to keep.</p>

      <div className="demo mt-7 text-[var(--a-fg)]">
        <div className="mb-3 flex gap-3 px-1 text-[13px] leading-relaxed sm:text-[14px]">
          <span className="pt-0.5 font-mono text-[11px] text-[var(--a-faint)]" aria-hidden>[ ]</span>
          <span>Create an app to explore outcomes by study group.</span>
        </div>
        <div ref={panel} onPointerDown={() => { lifecycle.current.hasPlayed = true; cancel() }} onFocusCapture={() => { lifecycle.current.hasPlayed = true; cancel() }} className="overflow-hidden rounded-xl border border-[var(--a-border)] bg-[var(--a-bg)] shadow-frame" aria-label="Interactive example app">
          <div className="flex items-center gap-2 border-b border-[var(--a-border)] bg-[var(--a-raised)] px-4 py-2.5 text-[11px] text-[var(--a-muted)]">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="size-3.5" aria-hidden><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M2 6h12M6 6v8" /></svg>
            <span>Apps</span><span aria-hidden>/</span><span className="text-[var(--a-fg)]">Study explorer</span>
            <span className="ml-auto size-1.5 rounded-full bg-[var(--a-go)]" aria-hidden />
          </div>
          <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h4 className="text-[18px] font-semibold tracking-[-0.025em]">Outcomes over time</h4>
                <span className="mt-1 block text-[11px] text-[var(--a-muted)]">A closer look at each study group</span>
              </div>
              <div>
                <label htmlFor={selectId} className="mb-1.5 block text-[10px] text-[var(--a-muted)]">Study group</label>
                <select id={selectId} value={cohort} onChange={(e) => setCohort(e.target.value as Cohort)} className={`${focusRing} min-w-36 rounded-md border border-[var(--a-border)] bg-[var(--a-raised)] px-2.5 py-1.5 text-[12px]`}>
                  {Object.entries(cohorts).map(([value, group]) => <option value={value} key={value}>{group.label}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-5 flex gap-10 border-b border-[var(--a-border)] pb-4" aria-live="polite" aria-atomic="true">
              <div><span className="block text-[10px] text-[var(--a-muted)]">Records</span><span className="mt-1 block text-[25px] leading-none tracking-[-0.03em] tabular-nums">{data.records}</span></div>
              <div><span className="block text-[10px] text-[var(--a-muted)]">Latest mean score</span><span className="mt-1 block text-[25px] leading-none tracking-[-0.03em] tabular-nums">{data.scores[2]}</span></div>
            </div>
            <svg viewBox="0 0 420 145" role="img" aria-label={`Mean scores for ${data.label}: ${data.scores.join(', ')} at baseline, week 4 and week 8.`} className="mt-4 block h-36 w-full sm:h-40" data-t-generate-skip>
              {[0, 25, 50].map((value) => <g key={value}><path d={`M28 ${112 - value * 1.8}H410`} stroke="var(--a-border)" strokeDasharray="3 4" /><text x="20" y={115 - value * 1.8} textAnchor="end" fill="var(--a-faint)" fontSize="8">{value}</text></g>)}
              {data.scores.map((value, index) => <g key={index}><rect x={65 + index * 125} y={112 - value * 1.8} width="58" height={value * 1.8} rx="3" fill="var(--a-ink)" opacity={0.65 + index * 0.15} /><text x={94 + index * 125} y="133" textAnchor="middle" fill="var(--a-muted)" fontSize="9">{['Baseline', 'Week 4', 'Week 8'][index]}</text></g>)}
            </svg>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-[var(--a-muted)]">
          <span>Interactive preview · illustrative data</span>
          <button type="button" disabled={building} onClick={() => void reveal().catch(cancel)} className={`${focusRing} rounded-sm underline decoration-[var(--a-border)] underline-offset-4 hover:text-[var(--a-fg)] disabled:cursor-wait disabled:no-underline`}>{building ? 'Drawing the app…' : 'Replay the build'}</button>
        </div>
      </div>
      <p className="mt-5 text-[13px] text-ink-subtle">Saved with your project. Built from a data snapshot you can refresh when your notebook changes.</p>
    </div>
  )
}
