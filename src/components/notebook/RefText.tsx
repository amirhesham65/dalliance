import { splitRefs } from '@/lib/notebook/text'

/** Prose with @variable references coloured. */
export function RefText({ text }: { text: string }) {
  return (
    <>
      {splitRefs(text).map((part, i) =>
        part.type === 'ref' ? (
          <span key={i} className="text-ref">
            {part.value}
          </span>
        ) : (
          part.value
        ),
      )}
    </>
  )
}
