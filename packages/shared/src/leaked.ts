/**
 * Some models write the rest of a tool call into one of its text fields, like
 * `…the answer.</answer>\n<parameter name="next">["Load the tips dataset"]`.
 * This splits that markup off and reads back the parameters it carried.
 */
export function splitLeaked(text: string): { text: string; params: Record<string, string> } {
  const body = text.replace(/^\s*<(answer|interpretation)>\s*/i, '')
  const start = body.search(/<\/?(?:answer|interpretation|parameter|invoke|function_calls)\b[^>]*>/i)
  if (start < 0) return { text: body.trim(), params: {} }
  const params: Record<string, string> = {}
  for (const m of body.slice(start).matchAll(/<parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?=<\/?parameter\b|<\/invoke>|$)/gi)) {
    params[m[1]] = m[2].trim()
  }
  return { text: body.slice(0, start).trim(), params }
}

/** A leaked list parameter, written as a JSON array. */
export function leakedList(value: string | undefined): string[] {
  if (!value) return []
  try {
    const list: unknown = JSON.parse(value)
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

/** The fields of `finish`, as a model may write them out as text instead of making the call. */
export interface LeakedFinish {
  interpretation: string
  answer: string
  next: string[]
}

/**
 * Some models end a cell by printing the arguments of `finish` as JSON, like `{"answer": "", "interpretation": "",
 * "next": []}`, instead of calling it. This reads that object back out of the text, alone or in a code fence or
 * after a sentence. Null when the text carries no such object. `rest` is what surrounded it.
 */
export function readFinishJson(text: string): (LeakedFinish & { rest: string }) | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  // Try each closing brace from the last one back, so a nested object or a brace in a string doesn't cut it short
  for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
    let value: unknown
    try {
      value = JSON.parse(text.slice(start, end + 1))
    } catch {
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const fields = value as Record<string, unknown>
    const known = ['answer', 'interpretation', 'next', 'suggestions'].filter((k) => k in fields)
    if (known.length === 0) return null
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const list = fields.next ?? fields.suggestions
    const rest = `${text.slice(0, start)}${text.slice(end + 1)}`.replace(/```(?:json)?/gi, '').trim()
    return {
      interpretation: str(fields.interpretation),
      answer: str(fields.answer),
      next: Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean) : [],
      rest,
    }
  }
  return null
}
