import { beforeEach, describe, expect, it, vi } from 'vitest'

// The query reads the user from the Convex JWT through Better Auth. Here that's a stand-in the tests set
const auth = vi.hoisted(() => ({ user: null as { _id: string } | null }))
vi.mock('./auth', () => ({ authComponent: { safeGetAuthUser: async () => auth.user }, fromWebsite: () => false }))
vi.mock('./billing', () => ({ polar: {} }))

const { MAX_CREDIT_IDS, credits } = await import('./usage')

type Row = { userId: string; generationId: string; costMicros: number }

/** A database with just the `usage` lookup by generation id, counting how many lookups the query made. */
function fakeCtx(rows: Row[]) {
  let lookups = 0
  const db = {
    query: (table: string) => {
      expect(table).toBe('usage')
      return {
        withIndex: (index: string, range: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
          expect(index).toBe('by_generation')
          let id = ''
          range({ eq: (_field, value) => (id = value) })
          lookups += 1
          return { unique: async () => rows.find((r) => r.generationId === id) ?? null }
        },
      }
    },
  }
  return { ctx: { db }, lookups: () => lookups }
}

type Handler = (ctx: unknown, args: { generationIds: string[] }) => Promise<{ generationId: string; credits: number }[] | null>
const run = (ctx: unknown, generationIds: string[]) => (credits as unknown as { _handler: Handler })._handler(ctx, { generationIds })

const ROWS: Row[] = [
  { userId: 'alice', generationId: 'gen_a1', costMicros: 42_000 },
  { userId: 'alice', generationId: 'gen_a2', costMicros: 1_500 },
  { userId: 'bob', generationId: 'gen_b1', costMicros: 90_000 },
]

describe('usage:credits', () => {
  beforeEach(() => {
    auth.user = null
    delete process.env.CREDITS_PER_USD
  })

  it("returns the signed-in user's calls in credits", async () => {
    auth.user = { _id: 'alice' }
    const { ctx } = fakeCtx(ROWS)
    // 100 credits a dollar unless set: $0.042 is 4.2 credits
    expect(await run(ctx, ['gen_a1', 'gen_a2'])).toEqual([
      { generationId: 'gen_a1', credits: 4.2 },
      { generationId: 'gen_a2', credits: 0.15 },
    ])
  })

  it("never returns another user's calls, whatever ids are sent", async () => {
    auth.user = { _id: 'alice' }
    const { ctx } = fakeCtx(ROWS)
    expect(await run(ctx, ['gen_a1', 'gen_b1'])).toEqual([{ generationId: 'gen_a1', credits: 4.2 }])
    auth.user = { _id: 'bob' }
    expect(await run(ctx, ['gen_a1', 'gen_b1'])).toEqual([{ generationId: 'gen_b1', credits: 9 }])
  })

  it('takes the user from the token, never from the arguments', () => {
    const args = JSON.parse((credits as unknown as { exportArgs: () => string }).exportArgs())
    expect(Object.keys(args.value)).toEqual(['generationIds'])
  })

  it('returns null when signed out', async () => {
    const { ctx, lookups } = fakeCtx(ROWS)
    expect(await run(ctx, ['gen_a1'])).toBeNull()
    expect(lookups()).toBe(0)
  })

  it('leaves out calls whose row has not landed yet', async () => {
    auth.user = { _id: 'alice' }
    const { ctx } = fakeCtx(ROWS)
    expect(await run(ctx, ['gen_a1', 'gen_later'])).toEqual([{ generationId: 'gen_a1', credits: 4.2 }])
  })

  it('uses the deployment rate, and looks each id up once, up to the limit', async () => {
    auth.user = { _id: 'alice' }
    process.env.CREDITS_PER_USD = '200'
    const { ctx, lookups } = fakeCtx(ROWS)
    expect(await run(ctx, ['gen_a1', 'gen_a1'])).toEqual([{ generationId: 'gen_a1', credits: 8.4 }])
    expect(lookups()).toBe(1)
    await run(ctx, Array.from({ length: MAX_CREDIT_IDS + 50 }, (_, i) => `gen_${i}`))
    expect(lookups()).toBe(1 + MAX_CREDIT_IDS)
  })
})
