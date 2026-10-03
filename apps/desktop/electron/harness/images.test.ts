import { describe, expect, it } from 'vitest'
import { MAX_IMAGES_PER_RESULT, MAX_IMAGES_PER_RUN, MAX_IMAGE_BYTES, MAX_RUN_IMAGE_BYTES, attachNote, imageBudget, toModelOutput } from './images'

const png = (size = 10) => ({ data: Buffer.alloc(size, 1), mediaType: 'image/png' })

describe('what the model is shown', () => {
  it('sends text as text, and text with images as content parts', () => {
    expect(toModelOutput({ output: 'Ran.' })).toEqual({ type: 'text', value: 'Ran.' })
    expect(toModelOutput({ output: { text: 'Ran.', images: [] } })).toEqual({ type: 'text', value: 'Ran.' })
    expect(toModelOutput({ output: { text: 'Ran.', images: [{ mediaType: 'image/png', data: 'AAAA' }] } })).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Ran.' },
        { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'AAAA' } },
      ],
    })
  })
})

describe('the image budget', () => {
  it('attaches a few images per result and stops at the run limit', async () => {
    const budget = imageBudget()
    const first = await budget.attach(Array.from({ length: 6 }, () => png()))
    expect(first).toMatchObject({ overBudget: 6 - MAX_IMAGES_PER_RESULT, unreadable: 0 })
    expect(first.images).toHaveLength(MAX_IMAGES_PER_RESULT)
    let shown = first.images.length
    while (shown < MAX_IMAGES_PER_RUN) shown += (await budget.attach([png()])).images.length
    expect(await budget.attach([png()])).toMatchObject({ images: [], overBudget: 1 })
  })

  it('stops at the bytes a run may send, whatever the count', async () => {
    // Prepared at the largest one image may be, four fit in a run and a fifth doesn't
    const budget = imageBudget(async (_data, mediaType) => ({ mediaType, data: 'A'.repeat(MAX_IMAGE_BYTES) }))
    expect(Math.floor(MAX_RUN_IMAGE_BYTES / MAX_IMAGE_BYTES)).toBe(4)
    expect((await budget.attach([png(), png(), png(), png()])).images).toHaveLength(4)
    expect(await budget.attach([png()])).toMatchObject({ images: [], overBudget: 1, unreadable: 0 })
  })

  it('drops an image too big to send whole, without shrinking', async () => {
    expect(await imageBudget().attach([png(MAX_IMAGE_BYTES)])).toMatchObject({ images: [], unreadable: 1 })
  })

  it('counts an image it cannot prepare as unreadable, not as shown', async () => {
    const budget = imageBudget(async () => null)
    expect(await budget.attach([png()])).toEqual({ images: [], overBudget: 0, unreadable: 1 })
  })
})

describe('the note beside the outputs', () => {
  it('says which charts are attached and why any are not', () => {
    const image = { mediaType: 'image/png', data: 'AAAA' }
    expect(attachNote(0, { images: [], overBudget: 0, unreadable: 0 })).toBe('')
    expect(attachNote(1, { images: [image], overBudget: 0, unreadable: 0 })).toBe('The chart is attached as an image.')
    expect(attachNote(2, { images: [image, image], overBudget: 0, unreadable: 0 })).toBe('The 2 charts are attached as images, in order.')
    expect(attachNote(3, { images: [image, image], overBudget: 1, unreadable: 0 })).toBe(
      'The first 2 of 3 charts are attached as images. 1 chart not attached: this run has shown you as many images as it can.',
    )
    expect(attachNote(1, { images: [], overBudget: 0, unreadable: 1 })).toBe("1 chart couldn't be prepared to show you.")
  })
})
