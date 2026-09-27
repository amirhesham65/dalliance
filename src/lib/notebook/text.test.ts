import { describe, expect, it } from 'vitest'
import { newNoteCell, newPromptCell } from '@/shared/notebook'
import { cellTitle, formatDuration, highlightPython, parseMarkdown, splitRefs, stripAnsi } from './text'

describe('splitRefs', () => {
  it('separates @references from prose', () => {
    expect(splitRefs('Why did @churn_by_plan spike?')).toEqual([
      { type: 'text', value: 'Why did ' },
      { type: 'ref', value: '@churn_by_plan' },
      { type: 'text', value: ' spike?' },
    ])
  })
})

describe('parseMarkdown', () => {
  it('reads headings and joins paragraph lines', () => {
    expect(parseMarkdown('# Title\nfirst line\nsecond line\n\n## Next')).toEqual([
      { type: 'h1', text: 'Title' },
      { type: 'p', text: 'first line second line' },
      { type: 'h2', text: 'Next' },
    ])
  })
})

describe('highlightPython', () => {
  it('tags keywords, strings, numbers, calls and comments without losing text', () => {
    const source = "import pd\nx = f('a', 14)  # note"
    const tokens = highlightPython(source)
    expect(tokens.filter((t) => t.type !== 'plain').map((t) => [t.type, t.value])).toEqual([
      ['k', 'import'],
      ['f', 'f'],
      ['s', "'a'"],
      ['n', '14'],
      ['c', '# note'],
    ])
    expect(tokens.map((t) => t.value).join('')).toBe(source)
  })
})

describe('cellTitle, formatDuration and stripAnsi', () => {
  it('uses the note heading and truncates long prompts', () => {
    expect(cellTitle(newNoteCell('# Churn review\nbody'))).toBe('Churn review')
    expect(cellTitle(newPromptCell('Load subscriptions.csv and the events table'), 19)).toBe('Load subscriptions…')
    expect(cellTitle(newPromptCell(''))).toBe('Empty prompt')
  })

  it('formats durations', () => {
    expect(formatDuration(900)).toBe('900ms')
    expect(formatDuration(1800)).toBe('1.8s')
    expect(formatDuration(95_000)).toBe('1m 35s')
  })

  it('removes terminal colour codes', () => {
    expect(stripAnsi('\u001b[0;31mKeyError\u001b[0m')).toBe('KeyError')
  })
})
