import { nativeImage } from 'electron'
import type { PrepareImage } from './harness/images'

/**
 * Shrinks an image for the agent with Chromium's decoder: a PNG when that fits, which keeps a chart's lines
 * and text crisp, and a JPEG at falling quality when it doesn't. nativeImage only reads PNG and JPEG, so a GIF
 * or WebP it can't decode goes as it is when it's already small enough.
 */
export const prepareImage: PrepareImage = async (data, mediaType, { maxSide, maxBytes }) => {
  const original = data.toString('base64')
  let image = nativeImage.createFromBuffer(data)
  if (image.isEmpty()) {
    // A PNG or JPEG nativeImage can't decode is damaged. A GIF or WebP may only be a format it doesn't read
    const undecodable = mediaType === 'image/gif' || mediaType === 'image/webp'
    return undecodable && original.length <= maxBytes ? { mediaType, data: original } : null
  }
  const { width, height } = image.getSize()
  const scale = Math.min(1, maxSide / Math.max(width, height))
  if (scale === 1 && original.length <= maxBytes) return { mediaType, data: original }
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
  const png = image.toPNG().toString('base64')
  if (png.length <= maxBytes) return { mediaType: 'image/png', data: png }
  for (const quality of [85, 70, 55]) {
    const jpeg = image.toJPEG(quality).toString('base64')
    if (jpeg.length <= maxBytes) return { mediaType: 'image/jpeg', data: jpeg }
  }
  return null
}
