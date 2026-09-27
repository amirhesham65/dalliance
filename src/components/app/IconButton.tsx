import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type IconButtonProps = ComponentProps<typeof Button> & { label: string }

/** Ghost icon button with a tooltip. `label` doubles as the accessible name. */
export function IconButton({ label, className, size = 'icon-sm', children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={label}
          className={cn('text-muted-foreground hover:text-foreground', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
