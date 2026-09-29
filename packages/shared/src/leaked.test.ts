import { describe, expect, it } from 'vitest'
import { leakedList, readFinishJson, splitLeaked } from './leaked'

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

describe('readFinishJson', () => {
  it('reads finish arguments a model printed instead of calling it', () => {
    expect(readFinishJson('{\n  "answer": "",\n  "interpretation": "",\n  "next": []\n}')).toEqual({ interpretation: '', answer: '', next: [], rest: '' })
    expect(readFinishJson('{"interpretation": "Rows are [[orders]].", "answer": "There are **200** rows.", "next": ["Plot it", " ", "Show columns"]}')).toMatchObject({
      interpretation: 'Rows are [[orders]].',
      answer: 'There are **200** rows.',
      next: ['Plot it', 'Show columns'],
    })
  })

  it('finds it in a code fence or after a sentence, and returns the words around it', () => {
    const fenced = readFinishJson('Done.\n```json\n{"answer": "It is 7.", "next": ["Why 7?"]}\n```')
    expect(fenced).toMatchObject({ answer: 'It is 7.', next: ['Why 7?'], rest: 'Done.' })
  })

  it('reads a brace inside a string, and accepts suggestions as the list', () => {
    expect(readFinishJson('{"answer": "Use {x} here", "suggestions": ["One"]}')).toMatchObject({ answer: 'Use {x} here', next: ['One'] })
  })

  it('leaves alone text that is not finish arguments', () => {
    expect(readFinishJson('The mean is 4.2.')).toBeNull()
    expect(readFinishJson('{"mean": 4.2}')).toBeNull()
    expect(readFinishJson('Use {curly} braces')).toBeNull()
    expect(readFinishJson('[1, 2, 3]')).toBeNull()
  })
})
