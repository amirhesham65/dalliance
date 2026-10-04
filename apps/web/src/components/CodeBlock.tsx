import { type ComponentProps, isValidElement, type ReactElement } from 'react'
import { Python } from './demo/Python'

/**
 * A fenced code block. Python gets the live demo's highlighting, in the app's own code colours, which
 * `.demo` in globals.css defines; other languages stay plain.
 */
export function CodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: unknown }>).props : null
  const text = typeof code?.children === 'string' ? code.children.replace(/\n$/, '') : null
  return (
    <pre
      className="demo mt-6 overflow-x-auto rounded-lg border bg-cell px-4 py-3.5 font-mono text-[13px] leading-[1.65] text-ink first:mt-0"
      {...props}
    >
      {text !== null && code?.className === 'language-python' ? <Python code={text} /> : text !== null ? <code>{text}</code> : children}
    </pre>
  )
}
