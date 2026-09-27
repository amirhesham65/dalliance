import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { useNotebook } from '@/store/notebook-store'
import { cn } from '@/lib/utils'

interface HighlightedEditorProps {
  cellId: string
  value: string
  onChange: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  render: (value: string) => ReactNode
  placeholder: string
  label: string
  className?: string
  /** Whether this editor takes focus when the store asks this cell to focus. */
  focusTarget?: boolean
}

/**
 * A textarea that grows with its content and shows styled text.
 * The textarea is transparent and sits over a mirror that renders the highlighting.
 */
export function HighlightedEditor({ cellId, value, onChange, onKeyDown, onFocus, onBlur, render, placeholder, label, className, focusTarget = true }: HighlightedEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const focusId = useNotebook((s) => s.focusId)

  useEffect(() => {
    if (!focusTarget || focusId !== cellId || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
    useNotebook.setState({ focusId: null })
  }, [focusId, cellId, focusTarget])

  return (
    <div className={cn('prompt-editor relative min-w-0 flex-1', className)}>
      <pre aria-hidden="true">
        {render(value)}
        {value.endsWith('\n') || !value ? ' ' : null}
      </pre>
      <textarea
        ref={ref}
        aria-label={label}
        spellCheck={false}
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </div>
  )
}
