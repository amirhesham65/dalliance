import { cn } from '@/lib/utils'

/**
 * The app's mark: a sun, half drawn in ink and half hatched, like a progress bar that is partly done.
 * Ilios is Greek for sun.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-3.5 shrink-0 overflow-hidden rounded-full border border-ink/80', className)}>
      <span className="w-1/2 bg-ink" />
      <span className="hatch w-1/2" />
    </span>
  )
}

export function Wordmark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={cn('flex items-center font-serif font-medium tracking-[-0.015em]', size === 'lg' ? 'gap-2.5 text-[34px] leading-none' : 'gap-2 text-[17px]')}>
      <Mark className={size === 'lg' ? 'size-6' : undefined} />
      Ilios
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

export function Kbd({ children }: { children: string }) {
  return <kbd className="font-sans text-xs text-faint tabular-nums">{children}</kbd>
}
