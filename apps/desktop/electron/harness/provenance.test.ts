// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildProvenance, describeChange, newTrail, noteApproval, readPath, statedRationale } from './provenance'

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
const step = (n: number, reasoning: string | null, modelId = 'anthropic/claude-sonnet-5.5') => ({ step: n, modelId, fallback: false, reasoning, usage, generationId: null })

describe('describeChange', () => {
  it('lists the lines that changed, removed before added', () => {
    expect(describeChange('a\nb\nc', 'a\nB\nc')).toBe('- b\n+ B')
    expect(describeChange('a\nc', 'a\nb\nc')).toBe('+ b')
    expect(describeChange('a\nb\nc', 'a\nc')).toBe('- b')
  })

  it('is empty for the same code', () => {
    expect(describeChange('x = 1', 'x = 1')).toBe('')
  })

  it('lists at most 12 lines and clips long ones', () => {
    const before = Array.from({ length: 20 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 20 }, (_, i) => `new ${i}`).join('\n')
    const lines = describeChange(before, after).split('\n')
    expect(lines).toHaveLength(13)
    expect(lines.at(-1)).toBe('… 28 more changed lines')
    expect(describeChange('x', 'y'.repeat(500)).split('\n')[1]).toHaveLength(200)
  })
})

describe('statedRationale', () => {
  it("is the model's reasoning summaries when any step has one", () => {
    expect(statedRationale([step(1, null), step(2, ' Group by plan. '), step(3, '')], 'Reads [[plan]].', 'Pro leads.')).toEqual({
      from: 'summaries',
      text: ['Group by plan.'],
    })
  })

  it('falls back to the interpretation and answer, and says so', () => {
    expect(statedRationale([step(1, null), step(2, null)], 'Reads [[plan]].', 'Pro leads.')).toEqual({ from: 'interpretation', text: ['Reads [[plan]].', 'Pro leads.'] })
    expect(statedRationale([step(1, null)], null, 'Pro leads.')).toEqual({ from: 'interpretation', text: ['Pro leads.'] })
    expect(statedRationale([], null, '  ')).toEqual({ from: 'none', text: [] })
  })

  it('clips a very long summary', () => {
    expect(statedRationale([step(1, 'x'.repeat(10_000))], null, null).text[0]).toHaveLength(4000)
  })
})

describe('buildProvenance', () => {
  const input = { prompt: 'Revenue by plan', corrections: [], model: 'm', effort: 'medium', steps: [], code: 'x', outputs: [], interpretation: null, answer: null }

  it('keeps at most 100 files and says when there were more', () => {
    const trail = newTrail()
    trail.agentReads = Array.from({ length: 120 }, (_, i) => `f${i}.csv`)
    const record = buildProvenance({ ...input, trail })
    expect(record.filesRead).toHaveLength(100)
    expect(record.filesReadTruncated).toBe(true)
  })

  it("carries the kernel's own note that it left files out", () => {
    const trail = newTrail()
    trail.readsTruncated = true
    expect(buildProvenance({ ...input, trail }).filesReadTruncated).toBe(true)
  })

  it("counts what earlier attempts read as the agent's reads", () => {
    const trail = newTrail()
    trail.attempts = [
      { code: 'a', error: 'NameError: a', filesRead: ['old.csv'] },
      { code: 'x', error: null, filesRead: ['new.csv'] },
    ]
    expect(buildProvenance({ ...input, trail }).filesRead).toEqual([
      { path: 'new.csv', by: 'code' },
      { path: 'old.csv', by: 'agent' },
    ])
    // A question answered in words has no final code, so nothing was read by it
    expect(buildProvenance({ ...input, code: '', trail }).filesRead.every((f) => f.by === 'agent')).toBe(true)
  })

  it('stamps the date it was made', () => {
    expect(buildProvenance({ ...input, trail: newTrail(), now: new Date('2026-09-30T12:00:00Z') }).madeAt).toBe('2026-09-30T12:00:00.000Z')
  })
})

describe('noteApproval', () => {
  it('keeps each answer once, and at most 20', () => {
    const trail = newTrail()
    noteApproval(trail, 'network', 'import requests', 'trusted')
    noteApproval(trail, 'network', 'import requests', 'trusted')
    expect(trail.approvals).toHaveLength(1)
    for (let i = 0; i < 30; i++) noteApproval(trail, 'packages', `pip install p${i}`, 'approved')
    expect(trail.approvals).toHaveLength(20)
  })
})

describe('readPath', () => {
  it("gives read_file's path the way the kernel reports paths", () => {
    expect(readPath('/work', './data/../orders.csv')).toBe('orders.csv')
    expect(readPath('/work', 'data/orders.csv')).toBe('data/orders.csv')
    expect(readPath('/work', '../secret.csv')).toBeNull()
  })
})
