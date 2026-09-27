import { describe, expect, it } from 'vitest'
import { leakedList, splitLeaked } from './leaked'

describe('splitLeaked', () => {
  it('leaves ordinary text alone', () => {
    expect(splitLeaked('Revenue rose **12%**. Use `df.head()` to look.')).toEqual({ text: 'Revenue rose **12%**. Use `df.head()` to look.', params: {} })
  })

  it('splits off a leaked tool call and reads its parameters', () => {
    const { text, params } = splitLeaked('Try the tips dataset.</answer>\n<parameter name="next">["Load tips", "Show its columns"]')
    expect(text).toBe('Try the tips dataset.')
    expect(leakedList(params.next)).toEqual(['Load tips', 'Show its columns'])
  })

  it('reads an answer that leaked into the interpretation', () => {
    const { text, params } = splitLeaked('Tips are [[before tax]].</interpretation>\n<parameter name="answer">Tips average **16%**.</parameter>')
    expect(text).toBe('Tips are [[before tax]].')
    expect(params.answer).toBe('Tips average **16%**.')
  })

  it('drops an opening tag', () => {
    expect(splitLeaked('<answer>Seven is most common.</answer>').text).toBe('Seven is most common.')
  })

  it('ignores a list that is not JSON', () => {
    expect(leakedList('Load tips, show columns')).toEqual([])
  })
})
