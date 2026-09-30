import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorBoundaryProps {
  /** What failed to show, for the message: "This cell", "This pane". */
  what: string
  className?: string
  children: ReactNode
}

/**
 * Keeps a throw in one cell or pane from blanking the whole window. It shows a short message in its place,
 * and Retry draws the children again, which is enough once the data behind them has changed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className={cn('flex flex-col items-start gap-2 rounded-lg border border-dashed px-3.5 py-3 text-[13px]', this.props.className)}>
        <p>{this.props.what} couldn't be shown.</p>
        {error.message && <p className="line-clamp-3 font-mono text-xs break-all text-muted-foreground">{error.message}</p>}
        <Button size="xs" variant="outline" onClick={() => this.setState({ error: null })}>
          Retry
        </Button>
      </div>
    )
  }
}
