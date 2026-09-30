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
  /** Tab and Shift+Tab indent and outdent lines, as in a code editor, instead of moving focus. */
  indent?: boolean
}

const INDENT = '    '

/** Indent or outdent the selected lines. execCommand keeps the change on the textarea's undo stack. */
function indentSelection(el: HTMLTextAreaElement, outdent: boolean) {
  const { value, selectionStart: start, selectionEnd: end } = el
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  if (!outdent && start === end) {
    document.execCommand('insertText', false, INDENT)
    return
  }
  const block = value.slice(lineStart, end)
  const lines = block.split('\n')
  const changed = lines.map((l) => (outdent ? l.replace(/^ {1,4}|^\t/, '') : INDENT + l)).join('\n')
  el.setSelectionRange(lineStart, end)
  document.execCommand('insertText', false, changed)
  const first = outdent ? Math.max(lineStart, start - (lines[0].length - lines[0].replace(/^ {1,4}|^\t/, '').length)) : start + INDENT.length
  el.setSelectionRange(first, lineStart + changed.length)
}

/**
 * A textarea that grows with its content and shows styled text.
 * The textarea is transparent and sits over a mirror that renders the highlighting.
 */
export function HighlightedEditor({ cellId, value, onChange, onKeyDown, onFocus, onBlur, render, placeholder, label, className, focusTarget = true, indent = false }: HighlightedEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // A yes or no for this cell, so a focus request for another cell doesn't redraw this editor
  const focusAsked = useNotebook((s) => s.focusId === cellId)

  useEffect(() => {
    if (!focusTarget || !focusAsked || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
    useNotebook.setState({ focusId: null })
  }, [focusAsked, focusTarget])

  // Padding and background go on the outer box. The textarea and its mirror share the inner box exactly,
  // so the caret and selection sit on the text you see.
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <div className="prompt-editor relative">
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
          onKeyDown={(e) => {
            if (indent && e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault()
              indentSelection(e.currentTarget, e.shiftKey)
              return
            }
            onKeyDown?.(e)
          }}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </div>
    </div>
  )
}
