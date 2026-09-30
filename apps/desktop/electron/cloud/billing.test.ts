// @vitest-environment node
import { getFunctionName } from 'convex/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Billing } from './billing'

type Rows = { generationId: string; credits: number }[] | null

/** Stands in for the Convex client: records the subscription, and lets a test answer it. */
function fakeClient() {
  const subs: { name: string; args: unknown; answer: (rows: Rows) => void; stopped: boolean }[] = []
  return {
    subs,
    onUpdate(query: Parameters<typeof getFunctionName>[0], args: unknown, answer: (rows: Rows) => void) {
      const sub = { name: getFunctionName(query), args, answer, stopped: false }
      subs.push(sub)
      return () => {
        sub.stopped = true
      }
    },
  }
}

function billing(signedIn = true) {
  const b = new Billing({ convexUrl: async () => 'https://example.convex.cloud', token: async () => 't', open: async () => {} })
  const client = fakeClient()
  // Set the client directly, as connect() would, without a deployment
  Object.assign(b as object, { client })
  if (signedIn) Object.assign(b as object, { signedIn: true })
  return { b, client }
}

describe("a run's credits", () => {
  afterEach(() => vi.useRealTimers())

  it('keeps counting until every call is in the ledger, then adds them up', async () => {
    const { b, client } = billing()
    const credits = b.credits(['gen_1', 'gen_2', 'gen_1'])
    const [sub] = client.subs
    expect(sub).toMatchObject({ name: 'usage:credits', args: { generationIds: ['gen_1', 'gen_2'] } })
    sub.answer([{ generationId: 'gen_1', credits: 4.2 }])
    expect(sub.stopped).toBe(false)
    sub.answer([
      { generationId: 'gen_1', credits: 4.2 },
      { generationId: 'gen_2', credits: 0.3 },
    ])
    expect(await credits).toBeCloseTo(4.5)
    expect(sub.stopped).toBe(true)
  })

  it('gives what arrived after the wait, or null when nothing did', async () => {
    vi.useFakeTimers()
    const { b, client } = billing()
    const partial = b.credits(['gen_1', 'gen_2'], 1000)
    client.subs[0].answer([{ generationId: 'gen_1', credits: 2 }])
    const none = b.credits(['gen_3'], 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await partial).toBe(2)
    expect(await none).toBeNull()
    expect(client.subs.every((s) => s.stopped)).toBe(true)
  })

  it('asks nothing when signed out or without calls', async () => {
    const { b, client } = billing(false)
    expect(await b.credits(['gen_1'])).toBeNull()
    expect(await billing().b.credits([])).toBeNull()
    expect(client.subs).toEqual([])
  })
})
