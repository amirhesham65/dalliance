import { highlightPython } from '@/lib/notebook/text'

export function PythonTokens({ code }: { code: string }) {
  return (
    <>
      {highlightPython(code).map((t, i) =>
        t.type === 'plain' ? (
          t.value
        ) : (
          <span key={i} className={t.type}>
            {t.value}
          </span>
        ),
      )}
    </>
  )
}
