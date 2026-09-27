import type { Cell } from '@/shared/notebook'

export type TextPart = { type: 'text'; value: string } | { type: 'ref'; value: string }

const REF = /@([a-z_][a-z0-9_]*)/gi

/** Split prose into plain text and @variable references. */
export function splitRefs(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) })
    parts.push({ type: 'ref', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export type MarkdownBlock = { type: 'h1' | 'h2' | 'p'; text: string }

/** Just enough Markdown for notes: # and ## headings, and paragraphs split by blank lines. */
export function parseMarkdown(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    para = []
  }
  for (const line of md.split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.*)/)
    if (heading) {
      flush()
      blocks.push({ type: heading[1].length === 1 ? 'h1' : 'h2', text: heading[2] })
    } else if (!line.trim()) flush()
    else para.push(line)
  }
  flush()
  return blocks
}

export type CodeToken = { type: 'k' | 's' | 'n' | 'f' | 'c' | 'plain'; value: string }

const PY = /(#.*$)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(import|from|as|lambda|def|return|if|else|for|in|and|or|not|True|False|None)\b|\b(\d+(?:\.\d+)?)\b|\b([a-z_][a-z0-9_]*)(?=\()/gim

/** A small Python highlighter for generated code. Good enough for display, not a parser. */
export function highlightPython(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let last = 0
  for (const m of code.matchAll(PY)) {
    if (m.index > last) tokens.push({ type: 'plain', value: code.slice(last, m.index) })
    const type = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 'n' : 'f'
    tokens.push({ type, value: m[0] })
    last = m.index + m[0].length
  }
  if (last < code.length) tokens.push({ type: 'plain', value: code.slice(last) })
  return tokens
}

export function cellTitle(cell: Cell, max = 48): string {
  const raw = cell.kind === 'note' ? (cell.markdown.split('\n')[0] ?? '').replace(/^#+\s*/, '') : cell.prompt
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return cell.kind === 'note' ? 'Empty note' : 'Empty prompt'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Tracebacks from Python can carry terminal colour codes. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** Time since a moment, the way a log reads it: now, 4m, 2h, 3d. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** "anthropic/claude-haiku-4-5-20251001" reads as "Haiku 4.5". Anything else shows as typed. */
export function modelLabel(model: string): string {
  const m = model.match(/claude-(opus|sonnet|haiku)-([\d]+(?:[.-]\d{1,2})?)/i)
  if (!m) return model.split('/').pop() ?? model
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2].replace('-', '.')}`
}
