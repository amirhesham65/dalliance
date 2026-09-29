import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The title and one line of what a section is for, at the top of its page. */
export function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <h2 className="font-serif text-[24px] leading-[1.2] font-medium tracking-[-0.015em]">{title}</h2>
      <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-muted-foreground">{children}</p>
    </div>
  )
}

/** A bordered group of rows, like the choices in the first-run setup. */
export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="mb-6 flex flex-col gap-2" aria-label={label}>
      {label && <h3 className="eyebrow px-0.5">{label}</h3>}
      <div className="flex flex-col divide-y rounded-lg border">{children}</div>
    </section>
  )
}

/**
 * One setting: its name and a line under it on the left, the control on the right. `wide` puts the control on
 * its own line under the text, for fields that need the width.
 */
export function Row({
  label,
  htmlFor,
  description,
  wide,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  description?: ReactNode
  wide?: boolean
  children?: ReactNode
  className?: string
}) {
  const text = (
    <div className="min-w-0 flex-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-[13.5px] font-medium">
          {label}
        </label>
      ) : (
        <p className="text-[13.5px] font-medium">{label}</p>
      )}
      {description && <div className="text-[12.5px] leading-[1.5] text-muted-foreground">{description}</div>}
    </div>
  )
  return (
    <div className={cn('px-3.5 py-3', wide ? 'flex flex-col gap-2.5' : 'flex items-center gap-4', className)}>
      {text}
      {children && <div className={cn(wide ? 'w-full' : 'shrink-0')}>{children}</div>}
    </div>
  )
}

/** The quiet line under a field: help, or a problem in red. */
export function Note({ id, error, children }: { id?: string; error?: boolean; children: ReactNode }) {
  return (
    <p id={id} className={cn('text-xs', error ? 'text-destructive' : 'text-faint')} role={error ? 'alert' : undefined}>
      {children}
    </p>
  )
}
