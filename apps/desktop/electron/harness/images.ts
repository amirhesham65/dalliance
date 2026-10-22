/**
 * What the agent sees. run_cell and explore attach the figures they make to their result, and view_image
 * attaches an image file, so the model looks at a chart instead of trusting that it came out right.
 *
 * Images stay in the run's history, which is append-only and resent on every step, and every step goes
 * to the provider on every step. Images are shrunk to bound request size and token usage,
 * and bounded per result and per run.
 */

/** An image as the model gets it: base64 bytes and their media type. */
export interface ModelImage {
  mediaType: string
  data: string
}

/** A tool result the model reads as text and looks at as images, in that order. */
export interface SeenOutput {
  text: string
  images: ModelImage[]
}

/** The longer side an image is shrunk to. Anthropic's models see up to this much without scaling it down again. */
export const MAX_IMAGE_SIDE = 1568
/** One image, in base64 characters, once shrunk. */
export const MAX_IMAGE_BYTES = 600_000
export const MAX_IMAGES_PER_RESULT = 4
export const MAX_IMAGES_PER_RUN = 10
/** All of a run's images together, in base64 characters, well inside the proxy's request limit. */
export const MAX_RUN_IMAGE_BYTES = 2_500_000

/** The image formats every offered model reads. */
export const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

/**
 * Shrinks an image to at most `maxSide` pixels on its longer side, re-encoded so it takes at most `maxBytes`
 * base64 characters. Null when it can't be read or made that small. The main process passes one built on
 * Electron's nativeImage; the harness never imports Electron.
 */
export type PrepareImage = (data: Buffer, mediaType: string, limits: { maxSide: number; maxBytes: number }) => Promise<ModelImage | null>

/** Without a way to shrink, as in tests, an image goes as it is when it is already small enough. */
export const passThrough: PrepareImage = async (data, mediaType, { maxBytes }) => {
  const encoded = data.toString('base64')
  return encoded.length <= maxBytes ? { mediaType, data: encoded } : null
}

export function isSeen(output: unknown): output is SeenOutput {
  return typeof output === 'object' && output !== null && typeof (output as SeenOutput).text === 'string' && Array.isArray((output as SeenOutput).images)
}

/** The text of a tool's output, whether or not it carries images. */
export const outputText = (output: unknown): string => (typeof output === 'string' ? output : isSeen(output) ? output.text : JSON.stringify(output))

/** A tool's output as the model gets it: plain text, or text followed by the images it attached. */
export function toModelOutput({ output }: { output: unknown }) {
  if (!isSeen(output) || !output.images.length) return { type: 'text' as const, value: outputText(output) }
  return {
    type: 'content' as const,
    value: [
      { type: 'text' as const, text: output.text },
      ...output.images.map((image) => ({ type: 'file' as const, mediaType: image.mediaType, data: { type: 'data' as const, data: image.data } })),
    ],
  }
}

/** What one attach gave the model, and what it left out and why. */
export interface Attached {
  images: ModelImage[]
  /** Past the per-result or per-run limits. */
  overBudget: number
  /** Couldn't be read, or made small enough. */
  unreadable: number
}

/** The images one run may show the model. Each run of the agent gets a fresh one. */
export function imageBudget(prepare: PrepareImage = passThrough) {
  let count = 0
  let bytes = 0
  return {
    async attach(sources: { data: Buffer; mediaType: string }[]): Promise<Attached> {
      const images: ModelImage[] = []
      let overBudget = 0
      let unreadable = 0
      for (const source of sources) {
        if (images.length >= MAX_IMAGES_PER_RESULT || count >= MAX_IMAGES_PER_RUN || bytes >= MAX_RUN_IMAGE_BYTES) {
          overBudget++
          continue
        }
        const image = await prepare(source.data, source.mediaType, { maxSide: MAX_IMAGE_SIDE, maxBytes: MAX_IMAGE_BYTES }).catch(() => null)
        if (!image || image.data.length > MAX_IMAGE_BYTES) {
          unreadable++
          continue
        }
        if (bytes + image.data.length > MAX_RUN_IMAGE_BYTES) {
          overBudget++
          continue
        }
        images.push(image)
        count++
        bytes += image.data.length
      }
      return { images, overBudget, unreadable }
    },
  }
}

/** One line telling the model which images it can see, and why any are missing. Empty when there's nothing to say. */
export function attachNote(total: number, { images, overBudget, unreadable }: Attached, noun = 'chart'): string {
  if (!total) return ''
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`
  const parts: string[] = []
  if (images.length === total) parts.push(total === 1 ? `The ${noun} is attached as an image.` : `The ${plural(total)} are attached as images, in order.`)
  else if (images.length) parts.push(`The first ${images.length} of ${plural(total)} ${images.length === 1 ? 'is' : 'are'} attached as images.`)
  if (overBudget) parts.push(`${plural(overBudget)} not attached: this run has shown you as many images as it can.`)
  if (unreadable) parts.push(`${plural(unreadable)} couldn't be prepared to show you.`)
  return parts.join(' ')
}
