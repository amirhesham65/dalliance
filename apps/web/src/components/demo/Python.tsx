// Just enough Python highlighting for the demo's Code tab, in the app's colours: keywords, strings, numbers,
// calls and comments. The app's own PythonTokens does more; the demo only shows code it wrote itself.
const TOKEN = /(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(from|import|for|in|if|else|and|or|not|lambda|return|True|False|None)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\()/g

export function Python({ code }: { code: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    if (m.index > last) parts.push(code.slice(last, m.index))
    const [text, comment, string, keyword, number] = m
    const tone = comment ? 'text-(--a-faint) italic' : string ? 'text-(--a-code-s)' : keyword ? 'text-(--a-code-k)' : number ? 'text-(--a-code-n)' : 'text-(--a-code-f)'
    parts.push(
      <span key={m.index} className={tone}>
        {text}
      </span>,
    )
    last = m.index + text.length
  }
  parts.push(code.slice(last))
  return <code>{parts}</code>
}
