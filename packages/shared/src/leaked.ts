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
