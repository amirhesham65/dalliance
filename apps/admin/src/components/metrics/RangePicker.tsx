'use client'

import { METRICS_RANGES, type MetricsRange } from '@dalliance/shared/metrics'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** The range as a segmented control. Changing it reloads the page's numbers through the URL, `?days=30`. */
export function RangePicker({ days }: { days: MetricsRange }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={String(days)}
      aria-label="Range"
      aria-busy={pending}
      className={pending ? 'opacity-60' : undefined}
      onValueChange={(value) => {
        if (value) startTransition(() => router.push(`/?days=${value}`))
      }}
    >
      {METRICS_RANGES.map((range) => (
        <ToggleGroupItem key={range} value={String(range)} className="px-3 tabular-nums data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          {range} days
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
