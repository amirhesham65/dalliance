import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@/components/app/IconButton'
import { cn } from '@/lib/utils'

interface PaneProps {
  title: ReactNode
  icon?: ReactNode
  /** Controls on the right of the header, before the close button. */
  actions?: ReactNode
  onClose?: () => void
  className?: string
  bodyClassName?: string
  label?: string
  /** A quiet line pinned under the body. */
  footer?: ReactNode
  children: ReactNode
}

/** A rounded card on the window canvas, with a quiet header. Every column of the app is one. */
export function Pane({ title, icon, actions, onClose, className, bodyClassName, label, footer, children }: PaneProps) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-pane', className)}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-4 text-[13px]">
        {icon && <span className="flex text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
        <h2 className="truncate font-medium">{title}</h2>
        <div className="ml-auto flex items-center gap-0.5">
          {actions}
          {onClose && (
            <IconButton label="Close" size="icon-xs" onClick={onClose}>
              <X />
            </IconButton>
          )}
        </div>
      </header>
      <div className={cn('scrollbar-thin min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
      {footer && <footer className="shrink-0 border-t px-4 py-2.5 text-xs text-faint">{footer}</footer>}
    </section>
  )
}
