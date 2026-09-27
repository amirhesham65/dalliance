import { Fragment, type ReactNode } from 'react'
import { RefText } from './RefText'

// `code` first so marks inside it stay literal, then **bold**, *italic* or _italic_, and [links](https://…)
const MARKS = /(`[^`]+`)|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])|\[([^\]]+)\]\(([^)\s]+)\)/g

/** A line of a note: inline Markdown marks, with @variable references coloured in the plain text. */
export function MarkdownText({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(MARKS)) {
    if (m.index > last) parts.push(<RefText key={`t${last}`} text={text.slice(last, m.index)} />)
    const [whole, code, bold, star, underscore, label, href] = m
    const key = m.index
    if (code)
      parts.push(
        <code key={key} className="rounded bg-raised px-1 py-px font-mono text-[0.85em] text-foreground">
          {code.slice(1, -1)}
        </code>,
      )
    else if (bold)
      parts.push(
        <strong key={key} className="font-semibold text-foreground">
          <MarkdownText text={bold} />
        </strong>,
      )
    else if (star || underscore)
      parts.push(
        <em key={key}>
          <MarkdownText text={star ?? underscore} />
        </em>,
      )
    else if (label && /^https?:\/\//.test(href))
      // Opens in the browser: the main process sends new-window links out and blocks in-app navigation
      parts.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" title={href} className="text-foreground underline decoration-ring underline-offset-2 hover:decoration-foreground">
          <MarkdownText text={label} />
        </a>,
      )
    else parts.push(<Fragment key={key}>{whole}</Fragment>)
    last = m.index + whole.length
  }
  if (last < text.length) parts.push(<RefText key={`t${last}`} text={text.slice(last)} />)
  return <>{parts}</>
}
