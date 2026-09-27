// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it } from 'vitest'
import type { RunCellRequest, RunEvent } from '@ilios/shared/ipc'
import { FakeKernel } from '../kernel/fake-kernel'
import { createApproval } from './approval'
import { EventBus } from './events'
import { type HarnessDeps, runCell } from './run-cell'

type Step = { tool: string; input: Record<string, unknown>; thinking?: string } | { text: string }

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

/** A model that plays back one scripted step per call: a tool call or a text reply. */
function scriptedModel(steps: Step[]) {
  let call = 0
  const prompts: unknown[] = []
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt)
      const step = steps[Math.min(call, steps.length - 1)]
      call += 1
      const chunks =
        'tool' in step
          ? [
              { type: 'stream-start' as const, warnings: [] },
              ...(step.thinking
                ? [
                    { type: 'reasoning-start' as const, id: `r${call}` },
                    { type: 'reasoning-delta' as const, id: `r${call}`, delta: step.thinking },
                    { type: 'reasoning-end' as const, id: `r${call}` },
                  ]
                : []),
              { type: 'tool-call' as const, toolCallId: `call-${call}`, toolName: step.tool, input: JSON.stringify(step.input) },
              { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage },
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't' },
              { type: 'text-delta' as const, id: 't', delta: step.text },
              { type: 'text-end' as const, id: 't' },
              { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'end_turn' }, usage },
            ]
      // Two chunk shapes in one array; the mock only needs valid stream parts at runtime
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) }
    },
  })
  return { model, prompts, calls: () => call }
}

function request(overrides: Partial<RunCellRequest> = {}): RunCellRequest {
  return { cellId: 'c1', prompt: 'Average order value by month', code: '', generate: true, corrections: [], previousCells: [], ...overrides }
}

function harness(model: MockLanguageModelV4, kernel: FakeKernel, extra: Partial<HarnessDeps> = {}) {
  const events: RunEvent[] = []
  const deps: HarnessDeps = {
    model,
    kernel,
    workspaceDir: mkdtempSync(path.join(tmpdir(), 'ilios-ws-')),
    bus: new EventBus(),
    pythonVersion: '3.12.0',
    projectInstructions: null,
    emit: (e) => events.push(e),
    askUser: async () => null,
    requestApproval: async () => false,
    needsApproval: createApproval({ mode: 'interactive' }),
    installPackages: async () => 'ok',
    signal: new AbortController().signal,
    ...extra,
  }
  return { deps, events }
}

const table = { type: 'table' as const, columns: ['month', 'aov'], index: ['0'], rows: [['2026-08', 41.2]], totalRows: 1 }

describe('runCell with generation', () => {
  it('retries after an error, then keeps the last working code', async () => {
    const kernel = new FakeKernel((code) =>
      code.includes('bad')
        ? { ok: false, outputs: [{ type: 'error', ename: 'KeyError', evalue: "'amount'", traceback: ['KeyError'] }] }
        : { ok: true, outputs: [table] },
    )
    const { model } = scriptedModel([
      { tool: 'list_variables', input: {} },
      { tool: 'run_cell', input: { code: 'orders.groupby("month").bad.mean()' } },
      { tool: 'run_cell', input: { code: 'orders.groupby("month").total.mean()' } },
      { tool: 'finish', input: { interpretation: 'Order value is [[total including tax]].', answer: 'August averaged $41.20.', next: ['"Plot it by month"', ' ', 'Median order value'] } },
    ])
    const { deps, events } = harness(model, kernel)

    const result = await runCell(request(), deps)

    expect(result).toMatchObject({
      ok: true,
      generated: true,
      code: 'orders.groupby("month").total.mean()',
      outputs: [table],
      interpretation: 'Order value is [[total including tax]].',
      answer: 'August averaged $41.20.',
      suggestions: ['Plot it by month', 'Median order value'],
      error: null,
    })
    expect(kernel.executed.filter((e) => e.store)).toHaveLength(2)
    expect(events.filter((e) => e.type === 'attempt')).toHaveLength(2)
    expect(result.activity.map((a) => [a.label, a.status])).toEqual([
      ['Checked variables', 'done'],
      ['Ran the cell', 'error'],
      ['Ran the cell', 'done'],
      ['Finished', 'done'],
    ])
  })

  it('puts the notebook context and the prompt in the first message', async () => {
    const kernel = new FakeKernel()
    kernel.vars = [{ name: 'orders', type: 'DataFrame', shape: '1,200 × 5', detail: 'month: object, total: float64' }]
    const { model, prompts } = scriptedModel([{ text: 'I cannot do that.' }])
    const { deps } = harness(model, kernel)
    writeFileSync(path.join(deps.workspaceDir, 'orders.csv'), 'month,total\n')

    await runCell(request({ previousCells: [{ kind: 'prompt', text: 'Load orders.csv', code: 'orders = pd.read_csv("orders.csv")' }] }), deps)

    const text = JSON.stringify(prompts[0])
    expect(text).toContain('orders: DataFrame 1,200 × 5')
    expect(text).toContain('orders.csv (12 B)')
    expect(text).toContain('Load orders.csv')
    expect(text).toContain('Average order value by month')
  })

  it('reports an error when the model never runs code', async () => {
    const { model } = scriptedModel([{ text: 'Which dataset do you mean?' }])
    const { deps } = harness(model, new FakeKernel())
    const result = await runCell(request(), deps)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Which dataset do you mean?')
  })

  it('refuses to finish before a successful run', async () => {
    const { model } = scriptedModel([
      { tool: 'finish', input: { interpretation: '', answer: '' } },
      { tool: 'run_cell', input: { code: 'x = 1\nx' } },
      { tool: 'finish', input: { interpretation: '', answer: '' } },
    ])
    const { deps } = harness(model, new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] })))
    const result = await runCell(request(), deps)
    expect(result.ok).toBe(true)
    expect(result.activity[0]).toMatchObject({ label: 'Tried to finish early' })
  })

  it('asks before installing a package and respects a no', async () => {
    const approvals: string[] = []
    let installed = false
    const { model, prompts } = scriptedModel([
      { tool: 'install_packages', input: { packages: ['seaborn'] } },
      { text: 'Okay.' },
    ])
    const { deps } = harness(model, new FakeKernel(), {
      requestApproval: async (title) => {
        approvals.push(title)
        return false
      },
      installPackages: async () => {
        installed = true
        return ''
      },
    })
    await runCell(request(), deps)
    expect(approvals).toEqual(['Install seaborn?'])
    expect(installed).toBe(false)
    expect(JSON.stringify(prompts[1])).toContain('The user declined installing seaborn')
  })

  it('lets an extension block a tool call', async () => {
    const { model, prompts } = scriptedModel([{ tool: 'read_file', input: { path: 'secrets.env' } }, { text: 'Blocked.' }])
    const { deps } = harness(model, new FakeKernel())
    deps.bus.on('tool_call', ({ toolName, input }) =>
      toolName === 'read_file' && String((input as { path: string }).path).endsWith('.env')
        ? { block: true, reason: '.env files are private.' }
        : undefined,
    )
    await runCell(request(), deps)
    expect(JSON.stringify(prompts[1])).toContain('Blocked: .env files are private.')
  })

  it('reports Stopped when the run is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { model } = scriptedModel([{ tool: 'list_variables', input: {} }])
    const { deps } = harness(model, new FakeKernel(), { signal: controller.signal })
    const result = await runCell(request(), deps)
    expect(result).toMatchObject({ ok: false, error: 'Stopped.' })
  })
})

describe('runCell without generation', () => {
  it('runs the existing code directly without calling the model', async () => {
    const kernel = new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '42' }] }))
    const { model, calls } = scriptedModel([{ text: 'unused' }])
    const { deps, events } = harness(model, kernel)
    const result = await runCell(request({ generate: false, code: '6 * 7' }), deps)
    expect(calls()).toBe(0)
    expect(result).toMatchObject({ ok: true, generated: false, code: '6 * 7', executionCount: 1 })
    expect(events).toContainEqual({ type: 'output', output: { type: 'text', text: '42' } })
  })
})

describe('safety limits', () => {
  it('stops an exploration that runs too long and tells the model why', async () => {
    let interrupted = false
    const kernel = new FakeKernel()
    kernel.execute = async (code, options) => {
      kernel.executed.push({ code, store: options.store })
      if (code.includes('glob')) await new Promise<void>((r) => (kernel.interrupt = () => ((interrupted = true), r())))
      return { ok: !code.includes('glob'), outputs: [], executionCount: null, durationMs: 1, assigned: [] }
    }
    const { model, prompts } = scriptedModel([{ tool: 'explore', input: { code: 'glob.glob("**/*.csv", recursive=True)' } }, { text: 'ok' }])
    const { deps } = harness(model, kernel)
    await runCell(request(), { ...deps, exploreTimeoutMs: 50 } as HarnessDeps)
    expect(interrupted).toBe(true)
    expect(JSON.stringify(prompts[1])).toContain('Exploration must be quick')
  })
})

describe('history', () => {
  it('only ever appends to what the model saw before, even over a long run with thinking', async () => {
    const explore = Array.from({ length: 16 }, (_, i) => ({ tool: 'explore', input: { code: `orders.iloc[${i}]` }, thinking: `Look at row ${i}.` }))
    const { model, prompts } = scriptedModel([
      ...explore,
      { tool: 'run_cell', input: { code: 'orders.total.sum()' }, thinking: 'Now the real cell.' },
      { tool: 'finish', input: { interpretation: '', answer: '' } },
    ])
    const { deps } = harness(model, new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] })))
    const result = await runCell(request(), deps)
    expect(result.ok).toBe(true)
    expect(prompts.length).toBe(18)
    for (let k = 1; k < prompts.length; k++) {
      const before = prompts[k - 1] as unknown[]
      const now = prompts[k] as unknown[]
      expect(now.slice(0, before.length)).toEqual(before)
    }
  })
})

describe('questions answered in words', () => {
  it('finishes without cell code when the prompt is a question', async () => {
    const kernel = new FakeKernel()
    const { model } = scriptedModel([
      { tool: 'list_variables', input: {} },
      { tool: 'finish', input: { interpretation: '', answer: 'A return-risk classifier fits best.\n- target: returned\n- features: category, region, price' } },
    ])
    const { deps } = harness(model, kernel)
    const result = await runCell(request({ prompt: 'What ML model could we build?', code: 'old = 1' }), deps)
    expect(result).toMatchObject({ ok: true, code: '', outputs: [], executionCount: null, error: null })
    expect(result.answer).toContain('return-risk classifier')
    expect(kernel.executed.filter((e) => e.store)).toHaveLength(0)
  })

  it('recovers follow-ups a model wrote into the answer as tool markup', async () => {
    const leaked = 'Try the Titanic dataset.</answer>\n<parameter name="next">["Load the titanic dataset", "Load the tips dataset"]'
    const { model } = scriptedModel([{ tool: 'finish', input: { interpretation: '', answer: leaked } }])
    const { deps } = harness(model, new FakeKernel())
    const result = await runCell(request({ prompt: 'Which dataset should I learn on?' }), deps)
    expect(result).toMatchObject({ ok: true, answer: 'Try the Titanic dataset.', suggestions: ['Load the titanic dataset', 'Load the tips dataset'] })
  })

  it('still refuses to finish with no code and no answer', async () => {
    const { model, prompts } = scriptedModel([{ tool: 'finish', input: { interpretation: '', answer: '' } }, { text: 'hm' }])
    const { deps } = harness(model, new FakeKernel())
    const result = await runCell(request(), deps)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(prompts[1])).toContain('Nothing has run yet')
  })
})
