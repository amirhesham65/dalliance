import type { Cell } from '@dalliance/shared/notebook'

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

export type MarkdownBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'p' | 'quote'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'rule' }

/**
 * The Markdown notes use: headings, paragraphs, lists, quotes, fenced code and rules.
 * Lines of a paragraph join into one, and a list item keeps the indented lines under it.
 */
export function parseMarkdown(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let para: string[] = []
  let list: Extract<MarkdownBlock, { type: 'list' }> | null = null
  let quote: string[] = []
  let fence: { lang: string; lines: string[] } | null = null
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join(' ') })
    if (quote.length) blocks.push({ type: 'quote', text: quote.join(' ') })
    para = []
    quote = []
  }
  const endList = () => {
    list = null
  }
  for (const line of md.split('\n')) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        blocks.push({ type: 'code', lang: fence.lang, text: fence.lines.join('\n') })
        fence = null
      } else fence.lines.push(line)
      continue
    }
    const open = line.match(/^\s*```\s*([\w+-]*)/)
    const heading = line.match(/^(#{1,6})\s+(.*)/)
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)/)
    const quoted = line.match(/^\s*>\s?(.*)/)
    if (open) {
      flush()
      endList()
      fence = { lang: open[1].toLowerCase(), lines: [] }
    } else if (heading) {
      flush()
      endList()
      const level = heading[1].length
      blocks.push({ type: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: heading[2].replace(/\s+#+\s*$/, '') })
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      endList()
      blocks.push({ type: 'rule' })
    } else if (item) {
      flush()
      const ordered = /\d/.test(item[1])
      const current = list as Extract<MarkdownBlock, { type: 'list' }> | null
      if (current && current.ordered === ordered) current.items.push(item[2])
      else {
        list = { type: 'list', ordered, start: ordered ? parseInt(item[1], 10) : 1, items: [item[2]] }
        blocks.push(list)
      }
    } else if (quoted) {
      if (para.length) flush()
      endList()
      quote.push(quoted[1])
    } else if (!line.trim()) {
      // A blank line ends a paragraph; a list carries on if the next line is another item
      flush()
    } else {
      const current = list as Extract<MarkdownBlock, { type: 'list' }> | null
      if (current && /^\s+/.test(line)) current.items[current.items.length - 1] += ` ${line.trim()}`
      else {
        if (quote.length) flush()
        endList()
        para.push(line.trim())
      }
    }
  }
  if (fence) blocks.push({ type: 'code', lang: fence.lang, text: fence.lines.join('\n') })
  flush()
  return blocks
}

export type AnswerBlock = { type: 'p'; text: string } | { type: 'list'; ordered: boolean; items: string[] }

/** Paragraphs and lists, which is all the formatting an answer needs. */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const item = line.match(/^([-*•]|\d+[.)])\s+(.*)/)
    const last = blocks[blocks.length - 1]
    if (item) {
      const ordered = /\d/.test(item[1])
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(item[2])
      else blocks.push({ type: 'list', ordered, items: [item[2]] })
    } else blocks.push(...inlineList(line))
  }
  return blocks
}

/**
 * "A good path: 1) explore the data, 2) clean it, 3) fit a model. It's quick." reads better as a list.
 * Needs a run of at least three "n)" markers counting up from 1. The last item ends with its sentence.
 */
function inlineList(line: string): AnswerBlock[] {
  const run: RegExpMatchArray[] = []
  for (const m of line.matchAll(/(?:^|\s)\(?(\d+)\)\s/g)) if (Number(m[1]) === run.length + 1) run.push(m)
  if (run.length < 3) return [{ type: 'p', text: line }]
  const items = run.map((m, i) => line.slice(m.index! + m[0].length, run[i + 1]?.index).trim())
  const lastItem = items[items.length - 1]
  const end = lastItem.search(/[.!?](?=\s+[A-Z])/)
  const tail = end >= 0 ? lastItem.slice(end + 1).trim() : ''
  if (end >= 0) items[items.length - 1] = lastItem.slice(0, end + 1)
  const lead = line.slice(0, run[0].index).trim()
  return [
    ...(lead ? [{ type: 'p' as const, text: lead }] : []),
    {
      type: 'list',
      ordered: true,
      items: items.map((i) => i.replace(/^(?:and|then)\s+/, '').replace(/[,;]\s*(?:and|then)?$/, '').replace(/^[a-z]/, (c) => c.toUpperCase())),
    },
    ...(tail ? [{ type: 'p' as const, text: tail }] : []),
  ]
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** **bold** and `code`, the two inline marks an answer carries, as HTML. */
const inlineHtml = (text: string) =>
  text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : part.startsWith('**') && part.endsWith('**') && part.length > 4
          ? `<strong>${escapeHtml(part.slice(2, -2))}</strong>`
          : escapeHtml(part),
    )
    .join('')

/** An answer as it reads on screen, for pasting into documents and chats that keep formatting. */
export function answerHtml(text: string): string {
  return answerBlocks(text)
    .map((b) => {
      if (b.type === 'p') return `<p>${inlineHtml(b.text)}</p>`
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`
    })
    .join('\n')
}

/** The same answer as Markdown, for editors that paste plain text. Inline lists come out as real lists. */
export function answerMarkdown(text: string): string {
  return answerBlocks(text)
    .map((b) => (b.type === 'p' ? b.text : b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : '-'} ${item}`).join('\n')))
    .join('\n\n')
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
  // A prompt cell shows its short title while the title still matches the prompt
  const named = cell.kind === 'prompt' && cell.title && cell.titleFrom?.trim() === cell.prompt.trim() ? cell.title : null
  const raw = cell.kind === 'note' ? (cell.markdown.split('\n')[0] ?? '').replace(/^#+\s*/, '') : (named ?? cell.prompt)
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
