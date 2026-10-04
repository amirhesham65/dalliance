'use client'

import type { MetricsDay } from '@dalliance/shared/metrics'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { cost, number, shortDay } from '@/lib/format'

type Series = 'signups' | 'activeUsers' | 'calls' | 'costUsd'

const LABELS: Record<Series, string> = { signups: 'Signups', activeUsers: 'Active users', calls: 'Model calls', costUsd: 'Model cost' }

/** One series over the range's days: bars for counts, an area for money. */
export function DailyChart({ data, series, color }: { data: MetricsDay[]; series: Series; color: string }) {
  const config = { [series]: { label: LABELS[series], color } } satisfies ChartConfig
  const format = series === 'costUsd' ? cost : number
  const axis = {
    x: <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortDay} />,
    y: (
      <YAxis
        width={series === 'costUsd' ? 56 : 32}
        tickLine={false}
        axisLine={false}
        allowDecimals={series === 'costUsd'}
        tickFormatter={(v: number) => (series === 'costUsd' ? `$${v < 10 ? v.toFixed(2) : Math.round(v)}` : number(v))}
      />
    ),
    tooltip: (
      <ChartTooltip
        cursor={series === 'costUsd'}
        content={
          <ChartTooltipContent
            labelFormatter={(_, payload) => shortDay(String(payload?.[0]?.payload?.day ?? ''))}
            formatter={(value) => (
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-muted-foreground">{LABELS[series]}</span>
                <span className="font-mono font-medium tabular-nums">{format(Number(value))}</span>
              </div>
            )}
          />
        }
      />
    ),
  }
  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      {series === 'costUsd' ? (
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="fill-cost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-costUsd)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-costUsd)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          {axis.x}
          {axis.y}
          {axis.tooltip}
          <Area dataKey="costUsd" type="monotone" stroke="var(--color-costUsd)" strokeWidth={2} fill="url(#fill-cost)" />
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          {axis.x}
          {axis.y}
          {axis.tooltip}
          <Bar dataKey={series} fill={`var(--color-${series})`} radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      )}
    </ChartContainer>
  )
}
