/**
 * Reading Python source as text, without running it. The code policy in the main process uses it, and so do
 * Verify's checks in the renderer (see verify.ts).
 */

export interface Scanned {
  /** The source with comments and string contents blanked out, same length and line breaks. */
  code: string
  strings: { text: string; at: number }[]
}

/** Separates Python code from its comments and string literals, keeping offsets. */
export function scanPython(src: string): Scanned {
  let code = ''
  const strings: Scanned['strings'] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      code += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const quote = src.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      let j = i + quote.length
      let text = ''
      while (j < src.length && !src.startsWith(quote, j)) {
        if (quote.length === 1 && src[j] === '\n') break
        const step = src[j] === '\\' ? 2 : 1
        text += src.slice(j, j + step)
        j += step
      }
      const end = Math.min(src.length, src.startsWith(quote, j) ? j + quote.length : j)
      strings.push({ text, at: i })
      code += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    code += c
    i += 1
  }
  return { code, strings }
}
