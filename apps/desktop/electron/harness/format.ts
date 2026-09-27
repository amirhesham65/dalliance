import type { Output } from '@dalliance/shared/notebook'
import type { VariableInfo } from '../kernel/kernel'

/** Every tool result is bounded, so one big output can't eat the context window. */
export function clip(text: string, max: number, keep: 'start' | 'end' = 'start'): string {
  if (text.length <= max) return text
  return keep === 'start'
    ? `${text.slice(0, max)}\n... (truncated, ${text.length - max} more characters)`
    : `... (truncated, showing the last ${max} characters)\n${text.slice(-max)}`
}

const TABLE_PREVIEW_ROWS = 15

export function outputsToText(outputs: Output[], max = 6000): string {
  if (!outputs.length) return '(no output)'
  const parts = outputs.map((o) => {
    switch (o.type) {
      case 'stream':
        return o.name === 'stderr' ? `[stderr]\n${o.text}` : o.text
      case 'text':
        return o.text
      case 'image':
        return '[a chart image, shown to the user in the notebook]'
      case 'error':
        return `${o.ename}: ${o.evalue}\n${clip(o.traceback.join(''), 3000, 'end')}`
      case 'table': {
        const header = ['', ...o.columns].join('\t')
        const rows = o.rows.slice(0, TABLE_PREVIEW_ROWS).map((r, i) => [o.index[i] ?? '', ...r.map((v) => String(v ?? ''))].join('\t'))
        const more = o.totalRows > TABLE_PREVIEW_ROWS ? `\n(${o.totalRows} rows in total, first ${TABLE_PREVIEW_ROWS} shown)` : ''
        const profile = o.profile?.length ? `\n[column overview, shown to the user]\n${o.profile.map(describeColumn).join('\n')}` : ''
        return `[table]\n${header}\n${rows.join('\n')}${more}${profile}`
      }
    }
  })
  return clip(parts.join('\n'), max)
}

function describeColumn(c: NonNullable<Extract<Output, { type: 'table' }>['profile']>[number]): string {
  const parts = [`${c.name} (${c.dtype})`, `${c.missing} missing`]
  if (c.unique != null) parts.push(`${c.unique} unique`)
  if (c.kind === 'number' || c.kind === 'date') parts.push(`range ${c.min} to ${c.max}${c.mean != null ? `, mean ${Number(c.mean).toFixed(2)}` : ''}`)
  if (c.top?.length) parts.push(`top: ${c.top.map(([v, n]) => `${v} (${n})`).join(', ')}`)
  return `- ${parts.join('; ')}`
}

export function formatVariables(vars: VariableInfo[], max = 40): string {
  if (!vars.length) return '(none yet)'
  const lines = vars.slice(0, max).map((v) => {
    const shape = v.shape ? ` ${v.shape}` : ''
    const detail = v.detail ? ` (${clip(v.detail, 300)})` : ''
    return `- ${v.name}: ${v.type}${shape}${detail}`
  })
  if (vars.length > max) lines.push(`- ... ${vars.length - max} more`)
  return lines.join('\n')
}
