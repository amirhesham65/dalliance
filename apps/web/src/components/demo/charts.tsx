'use client'

import { useEffect, useRef, useState } from 'react'
import type { Arm } from './data'

// Charts drawn the way the kernel's matplotlib style draws them (style_matplotlib() in dalliance_kernel.py): dark
// whatever the theme, so the demo's results look like the app's. SVG rather than a PNG, so they stay sharp and
// redraw when a correction changes the numbers.
const C = {
  background: '#161616',
  edge: '#3a3a3a',
  label: '#a3a3a3',
  text: '#e8e8e8',
  tick: '#8a8a8a',
  grid: '#262626',
  series: ['#5fb3b3', '#e8793b'],
}

const H = 320
type Plot = { left: number; right: number; top: number; bottom: number }

/**
 * The drawing's width in SVG units: 720 where the chart has room, 440 on a phone, so its text doesn't shrink
 * to nothing when the chart does. The server draws the wide one.
 */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width < 520 ? 440 : 720))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width, plot: { left: 66, right: width - 20, top: 44, bottom: 262 } }
}

/** The frame both charts share: background, title, axis labels. */
function Figure({ width, plot, title, xLabel, yLabel, label, children }: { width: number; plot: Plot; title: string; xLabel: string; yLabel: string; label: string; children: React.ReactNode }) {
  const W = width
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full rounded-md" style={{ fontFamily: 'var(--font-sans)' }}>
      <rect width={W} height={H} fill={C.background} />
      <text x={(plot.left + plot.right) / 2} y={26} textAnchor="middle" fill={C.text} fontSize={17}>
        {title}
      </text>
      <text x={(plot.left + plot.right) / 2} y={H - 14} textAnchor="middle" fill={C.label} fontSize={14}>
        {xLabel}
      </text>
      <text transform={`translate(18 ${(plot.top + plot.bottom) / 2}) rotate(-90)`} textAnchor="middle" fill={C.label} fontSize={14}>
        {yLabel}
      </text>
      {children}
    </svg>
  )
}

function Legend({ plot, labels }: { plot: Plot; labels: string[] }) {
  return (
    <g>
      {labels.map((l, i) => (
        <g key={l} transform={`translate(${plot.right - 150} ${plot.top + 16 + i * 24})`}>
          <line x1={0} x2={28} y1={0} y2={0} stroke={C.series[i]} strokeWidth={2.5} />
          <text x={38} y={5} fill={C.text} fontSize={14}>
            {l}
          </text>
        </g>
      ))}
    </g>
  )
}

const MONTHS = 48

/** Kaplan-Meier curves with censoring ticks, as lifelines' plot_survival_function draws them. */
export function SurvivalChart({ arms, title, xLabel }: { arms: Arm[]; title: string; xLabel: string }) {
  const { ref, width, plot } = useWidth()
  const x = (m: number) => plot.left + (Math.min(m, MONTHS) / MONTHS) * (plot.right - plot.left)
  const y = (s: number) => plot.top + (1 - s) * (plot.bottom - plot.top)
  const path = (arm: Arm) => {
    let d = `M${x(0)},${y(1)}`
    for (const [m, s] of arm.steps) if (m > 0) d += `H${x(m).toFixed(1)}V${y(s).toFixed(1)}`
    const last = arm.steps.at(-1)
    if (last && last[0] < MONTHS) d += `H${x(Math.max(...arm.censored.map(([m]) => m), last[0])).toFixed(1)}`
    return d
  }
  const summary = arms.map((a) => `${a.label}: median ${a.median == null ? 'not reached' : `${a.median} months`}`).join('; ')
  return (
    <div ref={ref}>
      <Figure width={width} plot={plot} title={title} xLabel={xLabel} yLabel="Survival probability" label={`${title}. ${summary}.`}>
        {[0, 12, 24, 36, 48].map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={plot.top} y2={plot.bottom} stroke={C.grid} />
            <text x={x(m)} y={plot.bottom + 22} textAnchor="middle" fill={C.tick} fontSize={14}>
              {m}
            </text>
          </g>
        ))}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((s) => (
          <g key={s}>
            <line x1={plot.left} x2={plot.right} y1={y(s)} y2={y(s)} stroke={C.grid} />
            <text x={plot.left - 10} y={y(s) + 5} textAnchor="end" fill={C.tick} fontSize={14}>
              {s.toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={y(0.5)} y2={y(0.5)} stroke="#555" strokeDasharray="1.5 3" />
        <path d={`M${plot.left},${plot.top}V${plot.bottom}H${plot.right}`} fill="none" stroke={C.edge} />
        {arms.map((arm, i) => (
          <g key={arm.label} stroke={C.series[i]}>
            {/* pathLength of 1 makes a dash of 1 the whole line, so the curve draws itself in on any data */}
            <path d={path(arm)} fill="none" strokeWidth={2} strokeLinejoin="round" pathLength={1} className="demo-draw" style={{ animationDelay: `${i * 120}ms` }} />
            {arm.censored.map(([m, s], j) => (
              <path key={j} d={`M${x(m).toFixed(1)},${(y(s) - 4).toFixed(1)}v8`} strokeWidth={1.2} className="demo-fade" />
            ))}
          </g>
        ))}
        <Legend plot={plot} labels={arms.map((a) => a.label)} />
      </Figure>
    </div>
  )
}

/** Counts per category for each arm, side by side, as pandas' bar plot draws them. */
export function BarChart({ categories, series, title, yLabel }: { categories: string[]; series: { label: string; values: number[] }[]; title: string; yLabel: string }) {
  const { ref, width, plot } = useWidth()
  const top = Math.max(2, ...series.flatMap((s) => s.values))
  const step = top > 12 ? 5 : 2
  const max = Math.ceil((top * 1.15) / step) * step
  const band = (plot.right - plot.left) / categories.length
  const bar = band * 0.32
  const yv = (v: number) => plot.bottom - (v / max) * (plot.bottom - plot.top)
  const summary = categories.map((c, i) => `${c}: ${series.map((s) => `${s.label} ${s.values[i]}`).join(', ')}`).join('; ')
  return (
    <div ref={ref}>
      <Figure width={width} plot={plot} title={title} xLabel="Reason" yLabel={yLabel} label={`${title}. ${summary}.`}>
        {Array.from({ length: max / step + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={plot.left} x2={plot.right} y1={yv(v)} y2={yv(v)} stroke={C.grid} />
            <text x={plot.left - 10} y={yv(v) + 5} textAnchor="end" fill={C.tick} fontSize={14}>
              {v}
            </text>
          </g>
        ))}
        <path d={`M${plot.left},${plot.top}V${plot.bottom}H${plot.right}`} fill="none" stroke={C.edge} />
        {categories.map((c, i) => {
          const centre = plot.left + band * (i + 0.5)
          return (
            <g key={c}>
              {series.map((s, j) => {
                const left = centre - bar + j * bar
                return <rect key={s.label} x={left} width={bar - 2} y={yv(s.values[i])} height={plot.bottom - yv(s.values[i])} fill={C.series[j]} className="demo-grow" style={{ animationDelay: `${(i * 2 + j) * 50}ms` }} />
              })}
              <text x={centre} y={plot.bottom + 22} textAnchor="middle" fill={C.tick} fontSize={14}>
                {c}
              </text>
            </g>
          )
        })}
        <Legend plot={plot} labels={series.map((s) => s.label)} />
      </Figure>
    </div>
  )
}
