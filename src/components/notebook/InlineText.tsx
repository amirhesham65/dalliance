import { Fragment } from 'react'

/** Answers and interpretations can carry `code` and **bold** from the model. Render just those two. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return (
            <code key={i} className="font-mono text-[0.9em] text-ref">
              {part.slice(1, -1)}
            </code>
          )
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          )
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}
