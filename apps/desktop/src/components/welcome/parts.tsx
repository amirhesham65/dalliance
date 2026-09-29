import { cn } from '@/lib/utils'

// The mark: sixteen squares on a 6 by 7 grid, a checkered left edge and a solid right one
const SQUARES = [[1, 0], [3, 0], [0, 1], [2, 1], [4, 1], [1, 2], [5, 2], [0, 3], [5, 3], [1, 4], [5, 4], [0, 5], [2, 5], [4, 5], [1, 6], [3, 6]]

export function Mark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 6 7" shapeRendering="crispEdges" className={cn('h-3.5 w-auto shrink-0 fill-current', className)}>
      {SQUARES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  )
}

export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={cn('flex items-center font-serif font-semibold tracking-[-0.02em]', size === 'lg' ? 'gap-3 text-[34px] leading-none' : 'gap-2 text-[17px]')}>
      <Mark className={size === 'lg' ? 'h-7' : undefined} />
      Dalliance
    </span>
  )
}

/** The first-run steps as the overview draws a notebook's progress: solid for done, hatched for what is left. */
export function StepBar({ steps, current, onSelect }: { steps: string[]; current: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3.5 overflow-hidden rounded-[3px] border border-ink/70">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => onSelect(i)}
            className={cn('h-full flex-1 transition-colors duration-300', i <= current ? 'bg-ink' : 'hatch', i > 0 && 'border-l border-background/60')}
          />
        ))}
      </div>
      <ol className="flex text-[12px] short:sr-only" aria-label="Setup steps">
        {steps.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={i === current ? 'step' : undefined}
              className={cn('rounded px-0.5 transition-colors hover:text-foreground', i === current ? 'font-medium text-foreground' : 'text-faint')}
            >
              {s}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

