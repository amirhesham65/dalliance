// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAnthropic } from '@ai-sdk/anthropic'
import { APICallError, RetryError, generateText } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import type { RunCellRequest, RunEvent } from '@dalliance/shared/ipc'
import { FakeKernel } from '../kernel/fake-kernel'
import { createApproval } from './approval'
import { type EventData, EventBus } from './events'
import { installExtensions } from './extensions'
import { agentProviderOptions, cloudGateway } from './model'
import { type HarnessDeps, friendlyError, runCell, servedByFallback } from './run-cell'
import { RUN_TIMEOUT_MS, duration } from './tools'

type Step = { tool: string; input: Record<string, unknown>; thinking?: string } | { text: string }

const usage = {
  inputTokens: { total: 10, noCache: 4, cacheRead: 5, cacheWrite: 1 },
  outputTokens: { total: 5, text: 3, reasoning: 2 },
}

/** A model that plays back one scripted step per call: a tool call or a text reply. */
function scriptedModel(steps: Step[]) {
  let call = 0
  const prompts: unknown[] = []
  const providerOptions: unknown[] = []
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt)
      providerOptions.push(options.providerOptions)
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
  return { model, prompts, providerOptions, calls: () => call }
}

function request(overrides: Partial<RunCellRequest> = {}): RunCellRequest {
  return { cellId: 'c1', prompt: 'Average order value by month', code: '', generate: true, corrections: [], previousCells: [], ...overrides }
}

function harness(model: MockLanguageModelV4, kernel: FakeKernel, extra: Partial<HarnessDeps> = {}) {
  const events: RunEvent[] = []
  const deps: HarnessDeps = {
    model,
    kernel,
    workspaceDir: mkdtempSync(path.join(tmpdir(), 'dalliance-ws-')),
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
  it('asks for no suggested next prompts when they are off, and drops any the model writes anyway', async () => {
    const steps = [
      { tool: 'run_cell', input: { code: 'orders.total.mean()' } },
      { tool: 'finish', input: { interpretation: '', answer: 'The mean is **41.2**.', next: ['Plot totals by month'] } },
    ]
    const kernel = () => new FakeKernel(() => ({ ok: true, outputs: [table] }))
    const on = scriptedModel(steps)
    const off = scriptedModel(steps)

    expect(await runCell(request(), harness(on.model, kernel()).deps)).toMatchObject({ ok: true, suggestions: ['Plot totals by month'] })
    const result = await runCell(request(), harness(off.model, kernel(), { suggestNext: false }).deps)
    expect(result).toMatchObject({ ok: true, answer: 'The mean is **41.2**.', suggestions: [] })

    const [systemOn, userOn] = on.prompts[0] as { role: string; content: unknown }[]
    const [systemOff, userOff] = off.prompts[0] as { role: string; content: unknown }[]
    expect(JSON.stringify(userOff)).toContain('Leave next empty in finish.')
    expect(JSON.stringify(userOn)).not.toContain('Leave next empty')
    // The rule goes in the cell prompt, so the cached system prompt is the same either way
    expect(systemOff).toEqual(systemOn)
  })

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

  it('asks before code uses the network, through the same approval as installs', async () => {
    const approvals: [string, string, string[]][] = []
    const kernel = new FakeKernel()
    const { model, prompts } = scriptedModel([{ tool: 'run_cell', input: { code: 'import requests\nrates = requests.get(URL).json()' } }, { text: 'Okay.' }])
    const { deps } = harness(model, kernel, {
      requestApproval: async (...args) => {
        approvals.push(args)
        return false
      },
    })
    installExtensions(deps.bus, { logDir: mkdtempSync(path.join(tmpdir(), 'dalliance-log-')) })
    const result = await runCell(request(), deps)
    expect(approvals).toEqual([['Let the agent use the network?', 'import requests', ['code:network']]])
    expect(kernel.executed).toEqual([])
    expect(JSON.stringify(prompts[1])).toContain('Blocked: the user declined letting the code use the network')
    expect(result.activity[0]).toMatchObject({ status: 'error' })
  })

  it('runs network code without asking in background mode', async () => {
    let asked = false
    const kernel = new FakeKernel()
    const { model } = scriptedModel([{ tool: 'explore', input: { code: 'import requests' } }, { text: 'Okay.' }])
    const { deps } = harness(model, kernel, {
      needsApproval: createApproval({ mode: 'background' }),
      requestApproval: async () => (asked = true),
    })
    installExtensions(deps.bus, { logDir: mkdtempSync(path.join(tmpdir(), 'dalliance-log-')) })
    await runCell(request(), deps)
    expect(asked).toBe(false)
    expect(kernel.executed).toEqual([{ code: 'import requests', store: false }])
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

describe('observability', () => {
  it('reports every step with its model, finish reason, duration and token usage', async () => {
    const { model } = scriptedModel([{ tool: 'run_cell', input: { code: 'x = 1\nx' } }, { tool: 'finish', input: { interpretation: '', answer: '' } }])
    const { deps } = harness(model, new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] })))
    const order: string[] = []
    const steps: EventData[] = []
    deps.bus.on('tool_result', ({ toolName }) => void order.push(`result ${toolName}`))
    deps.bus.on('step', (data) => {
      order.push(`step ${data.step}`)
      steps.push(data)
    })
    await runCell(request(), deps)
    expect(order).toEqual(['result run_cell', 'step 1', 'result finish', 'step 2'])
    expect(steps[0]).toEqual({
      cellId: 'c1',
      step: 1,
      modelId: 'mock-model-id',
      fallback: false,
      finishReason: 'tool-calls',
      durationMs: expect.any(Number),
      reasoning: null,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 5, cacheWriteTokens: 1, reasoningTokens: 2 },
    })
  })

  it("keeps each step's reasoning summary, and null for a step without one", async () => {
    const { model } = scriptedModel([
      { tool: 'explore', input: { code: 'orders.head()' }, thinking: 'Look at the columns first.' },
      { tool: 'run_cell', input: { code: 'x = 1\nx' } },
      { tool: 'finish', input: { interpretation: '', answer: '' }, thinking: 'It ran, so finish.' },
    ])
    const { deps } = harness(model, new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] })))
    const logged: (string | null | undefined)[] = []
    deps.bus.on('step', (data) => void logged.push(data.reasoning))
    const result = await runCell(request(), deps)
    expect(result.steps).toEqual([
      { step: 1, modelId: 'mock-model-id', fallback: false, reasoning: 'Look at the columns first.' },
      { step: 2, modelId: 'mock-model-id', fallback: false, reasoning: null },
      { step: 3, modelId: 'mock-model-id', fallback: false, reasoning: 'It ran, so finish.' },
    ])
    expect(logged).toEqual(['Look at the columns first.', null, 'It ran, so finish.'])
  })

  it('writes the steps to agent.jsonl through the built-in log', async () => {
    const { model } = scriptedModel([{ tool: 'finish', input: { interpretation: '', answer: 'Nothing to run.' } }])
    const { deps } = harness(model, new FakeKernel())
    const logDir = mkdtempSync(path.join(tmpdir(), 'dalliance-log-'))
    const { log } = installExtensions(deps.bus, { logDir })
    await runCell(request(), deps)
    await log.idle()
    const events = readFileSync(log.file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    expect(events.map((e) => e.event)).toEqual(['run_start', 'tool_call', 'tool_result', 'step', 'run_end'])
    expect(events[3]).toMatchObject({ step: 1, fallback: false, finishReason: 'tool-calls', reasoning: null, usage: { cacheReadTokens: 5, cacheWriteTokens: 1 } })
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

describe('parallel tool calls', () => {
  it('makes finish wait for a run_cell sent in the same step', async () => {
    const chunks = [
      { type: 'stream-start' as const, warnings: [] },
      { type: 'tool-call' as const, toolCallId: 'call-1', toolName: 'run_cell', input: JSON.stringify({ code: 'total = orders.total.sum()\ntotal' }) },
      { type: 'tool-call' as const, toolCallId: 'call-2', toolName: 'finish', input: JSON.stringify({ interpretation: '', answer: '' }) },
      { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' }, usage },
    ]
    const text = [
      { type: 'stream-start' as const, warnings: [] },
      { type: 'text-start' as const, id: 't' },
      { type: 'text-delta' as const, id: 't', delta: 'Stuck.' },
      { type: 'text-end' as const, id: 't' },
      { type: 'finish' as const, finishReason: { unified: 'stop' as const, raw: 'end_turn' }, usage },
    ]
    let calls = 0
    // One step with both calls, then plain text, so a refused finish would leave the cell unfinished
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: (calls++ === 0 ? chunks : text) as never[] }) }) })
    const kernel = new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '42' }] }))
    const execute = kernel.execute.bind(kernel)
    kernel.execute = async (code, options) => {
      await new Promise((r) => setTimeout(r, 50))
      return execute(code, options)
    }
    const { deps } = harness(model, kernel)
    const result = await runCell(request(), deps)
    expect(result).toMatchObject({ ok: true, code: 'total = orders.total.sum()\ntotal', outputs: [{ type: 'text', text: '42' }], error: null })
    expect(result.activity.map((a) => a.label)).toEqual(['Ran the cell', 'Finished'])
    expect(calls).toBe(1)
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

describe('the run_cell time limit', () => {
  /** A kernel whose runs of `slow` code only end when interrupted, the way Ctrl+C ends a stuck cell. */
  function stuckKernel(onInterrupt: 'returns' | 'throws') {
    const kernel = new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] }))
    const execute = kernel.execute.bind(kernel)
    let interrupts = 0
    kernel.interrupt = () => void interrupts++
    kernel.execute = async (code, options) => {
      if (!code.includes('slow')) return execute(code, options)
      kernel.executed.push({ code, store: options.store })
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => interrupts > 0 && (clearInterval(poll), resolve()), 5)
      })
      if (onInterrupt === 'throws') throw new Error('The kernel was killed.')
      return { ok: false, outputs: [{ type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: ['KeyboardInterrupt'] }], executionCount: 1, durationMs: 60, assigned: [] }
    }
    return { kernel, interrupts: () => interrupts }
  }

  it.each(['returns', 'throws'] as const)('interrupts a run that takes too long and tells the model, when the kernel %s', async (onInterrupt) => {
    const { kernel, interrupts } = stuckKernel(onInterrupt)
    const { model, prompts } = scriptedModel([
      { tool: 'run_cell', input: { code: 'slow_model.fit(everything)' } },
      { tool: 'finish', input: { interpretation: '', answer: '' } },
      { text: 'It is too slow.' },
    ])
    const { deps } = harness(model, kernel, { runTimeoutMs: 40 })
    const result = await runCell(request(), deps)
    expect(interrupts()).toBe(1)
    const told = JSON.stringify(prompts[1])
    expect(told).toContain('The cell timed out after 1 second and was stopped.')
    // Bounded: a fixed message, not the kernel's output
    expect(told).not.toContain('KeyboardInterrupt')
    // finish refuses the timed-out run
    expect(JSON.stringify(prompts[2])).toContain('The last run_cell failed')
    expect(result).toMatchObject({ ok: false, code: 'slow_model.fit(everything)' })
    expect(result.activity[0]).toMatchObject({ label: 'Ran the cell', detail: 'Stopped after 1 second', status: 'error' })
  })

  it('leaves runs inside the limit alone', async () => {
    const { kernel, interrupts } = stuckKernel('returns')
    const { model } = scriptedModel([{ tool: 'run_cell', input: { code: 'x = 1\nx' } }, { tool: 'finish', input: { interpretation: '', answer: '' } }])
    const { deps } = harness(model, kernel, { runTimeoutMs: 200 })
    const result = await runCell(request(), deps)
    expect(result.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 250))
    expect(interrupts()).toBe(0)
  })

  it('defaults to ten minutes', () => {
    expect(RUN_TIMEOUT_MS).toBe(600_000)
    expect(duration(RUN_TIMEOUT_MS)).toBe('10 minutes')
    expect(duration(60_000)).toBe('1 minute')
    expect(duration(45_000)).toBe('45 seconds')
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

/**
 * One Anthropic Messages stream that ends in a single tool call, as server-sent events. With `fallbackTo`, `model`
 * declines first and that model answers, as the API reports a server-side fallback.
 */
function anthropicToolStream(
  id: string,
  name: string,
  input: Record<string, unknown>,
  { model = 'claude-opus-5', fallbackTo }: { model?: string; fallbackTo?: string } = {},
): string {
  const iterations = fallbackTo
    ? [
        { type: 'message', model, input_tokens: 10, output_tokens: 0 },
        { type: 'fallback_message', model: fallbackTo, input_tokens: 10, output_tokens: 5 },
      ]
    : undefined
  const blocks: unknown[] = fallbackTo ? [{ type: 'fallback' }] : []
  const at = blocks.length
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: `msg_${id}`, model, role: 'assistant', content: [], usage: { input_tokens: 10 } } }],
    ...blocks.flatMap((block, index): [string, unknown][] => [
      ['content_block_start', { type: 'content_block_start', index, content_block: block }],
      ['content_block_stop', { type: 'content_block_stop', index }],
    ]),
    ['content_block_start', { type: 'content_block_start', index: at, content_block: { type: 'tool_use', id: `toolu_${id}`, name, input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: at, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
    ['content_block_stop', { type: 'content_block_stop', index: at }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5, ...(iterations ? { iterations } : {}) } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

describe('caching', () => {
  const anthropicOptions = agentProviderOptions({ provider: 'anthropic', model: 'claude-opus-5', effort: 'high' })

  it('asks for automatic caching on every step and marks no message but the system prompt', async () => {
    const { model, prompts, providerOptions } = scriptedModel([
      { tool: 'list_variables', input: {} },
      { tool: 'run_cell', input: { code: 'x = 1\nx' } },
      { tool: 'finish', input: { interpretation: '', answer: '' } },
    ])
    const { deps } = harness(model, new FakeKernel(() => ({ ok: true, outputs: [{ type: 'text', text: '1' }] })), { providerOptions: anthropicOptions })
    await runCell(request(), deps)
    expect(providerOptions).toHaveLength(3)
    for (const options of providerOptions) expect(options).toMatchObject({ anthropic: { cacheControl: { type: 'ephemeral' } } })
    const messages = prompts[2] as { role: string; providerOptions?: unknown }[]
    expect(messages[0]).toMatchObject({ role: 'system', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } })
    expect(messages.slice(1).filter((m) => JSON.stringify(m.providerOptions ?? {}).includes('cacheControl'))).toEqual([])
  })

  it('sends a top-level cache_control to the Anthropic API on every step, over an append-only history', async () => {
    const bodies: Record<string, unknown>[] = []
    const replies = [anthropicToolStream('1', 'list_variables', {}), anthropicToolStream('2', 'finish', { interpretation: '', answer: 'Nothing to compute.' })]
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(replies[bodies.length - 1], { headers: { 'content-type': 'text/event-stream' } })
    }
    const model = createAnthropic({ apiKey: 'test-key', fetch })('claude-opus-5')
    const { deps } = harness(model as unknown as MockLanguageModelV4, new FakeKernel(), { providerOptions: anthropicOptions })

    const result = await runCell(request({ prompt: 'What could we model here?' }), deps)

    expect(result).toMatchObject({ ok: true, answer: 'Nothing to compute.' })
    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      expect(body.cache_control).toEqual({ type: 'ephemeral' })
      // One tool call per step
      expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
      expect((body.system as { cache_control?: unknown }[]).at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    }
    // The second step resends the first step's messages unchanged, so it reads them from the cache
    const [first, second] = bodies.map((b) => b.messages as unknown[])
    expect(second.slice(0, first.length)).toEqual(first)
    expect(second.length).toBeGreaterThan(first.length)
  })
})

describe('the refusal fallback', () => {
  it('asks the Anthropic API for it on every step, and logs the model that answered when it ran', async () => {
    const sent: { body: Record<string, unknown>; beta: string | null }[] = []
    const replies = [
      anthropicToolStream('1', 'list_variables', {}, { model: 'claude-sonnet-5-5' }),
      anthropicToolStream('2', 'finish', { interpretation: '', answer: 'Nothing to compute.' }, { model: 'claude-sonnet-5-5', fallbackTo: 'claude-opus-4-8' }),
    ]
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push({ body: JSON.parse(String(init?.body)), beta: new Headers(init?.headers).get('anthropic-beta') })
      return new Response(replies[sent.length - 1], { headers: { 'content-type': 'text/event-stream' } })
    }
    const model = createAnthropic({ apiKey: 'test-key', fetch })('claude-sonnet-5-5')
    const providerOptions = agentProviderOptions({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' })
    const { deps } = harness(model as unknown as MockLanguageModelV4, new FakeKernel(), { providerOptions, modelId: 'claude-sonnet-5-5' })
    const logged: EventData[] = []
    deps.bus.on('step', (data) => void logged.push(data))

    const result = await runCell(request({ prompt: 'What could we model here?' }), deps)

    expect(result).toMatchObject({ ok: true, answer: 'Nothing to compute.' })
    // The same options on every step, so the prompt cache holds
    expect(sent).toHaveLength(2)
    for (const { body, beta } of sent) {
      expect(body.fallbacks).toBe('default')
      expect(beta).toContain('server-side-fallback-2026-07-01')
    }
    expect(result.steps.map(({ modelId, fallback }) => ({ modelId, fallback }))).toEqual([
      { modelId: 'claude-sonnet-5-5', fallback: false },
      { modelId: 'claude-opus-4-8', fallback: true },
    ])
    expect(logged.map(({ modelId, fallback }) => ({ modelId, fallback }))).toEqual([
      { modelId: 'claude-sonnet-5-5', fallback: false },
      { modelId: 'claude-opus-4-8', fallback: true },
    ])
  })

  it('reads a fallback from the usage iterations, the last one being the model that served', () => {
    const iterations = [
      { type: 'message', model: 'claude-fable-5-1', inputTokens: 1, outputTokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-5', inputTokens: 1, outputTokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-4-8', inputTokens: 1, outputTokens: 4 },
    ]
    expect(servedByFallback({ anthropic: { iterations } })).toEqual({ fallback: true, model: 'claude-opus-4-8' })
    expect(servedByFallback({ anthropic: { iterations: [{ type: 'fallback_message', inputTokens: 1, outputTokens: 4 }] } })).toEqual({ fallback: true, model: null })
    expect(servedByFallback({ anthropic: { iterations: [{ type: 'compaction', inputTokens: 1, outputTokens: 1 }] } })).toEqual({ fallback: false, model: null })
    expect(servedByFallback({ anthropic: { iterations: null } })).toEqual({ fallback: false, model: null })
    expect(servedByFallback(undefined)).toEqual({ fallback: false, model: null })
  })
})

describe('the brief', () => {
  it('goes in the cell message, not the system prompt', async () => {
    const { model, prompts } = scriptedModel([{ text: 'ok' }])
    const { deps } = harness(model, new FakeKernel(), { projectInstructions: 'Revenue means net of refunds.' })
    await runCell(request(), deps)
    const [system, user] = prompts[0] as { role: string; content: unknown }[]
    expect(system.role).toBe('system')
    expect(JSON.stringify(system.content)).not.toContain('Revenue means net of refunds.')
    expect(user.role).toBe('user')
    expect(JSON.stringify(user.content)).toContain('Revenue means net of refunds.')
  })

  it('leaves the system prompt the same whatever the brief says', async () => {
    const systems: unknown[] = []
    for (const brief of [null, 'Use metric units.', 'x'.repeat(50_000)]) {
      const { model, prompts } = scriptedModel([{ text: 'ok' }])
      const { deps } = harness(model, new FakeKernel(), { projectInstructions: brief })
      await runCell(request(), deps)
      systems.push((prompts[0] as unknown[])[0])
    }
    expect(systems[1]).toEqual(systems[0])
    expect(systems[2]).toEqual(systems[0])
  })
})

describe('friendlyError', () => {
  const apiError = (statusCode: number | undefined, message: string) =>
    new APICallError({ message, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode, isRetryable: statusCode == null || statusCode === 429 })

  it('reads a 401 as a rejected key', () => {
    expect(friendlyError(apiError(401, 'invalid x-api-key'))).toMatch(/^The model provider rejected the API key/)
  })

  it('reads a 429 as rate limiting, also after retries', () => {
    expect(friendlyError(apiError(429, 'Too many requests'))).toMatch(/rate limiting/)
    const retried = new RetryError({ message: 'Failed after 3 attempts.', reason: 'maxRetriesExceeded', errors: [apiError(429, 'Too many requests')] })
    expect(friendlyError(retried)).toMatch(/rate limiting/)
  })

  it("doesn't read a token count as a status", () => {
    const message = 'prompt is too long: 40132 tokens > 4010 maximum, 429 left over'
    expect(friendlyError(apiError(400, message))).toBe(message)
    expect(friendlyError(new Error(message))).toBe(message)
    expect(friendlyError(new Error('Used 401 tokens of 403 allowed'))).toBe('Used 401 tokens of 403 allowed')
  })

  it('reads a 404 about the model as a wrong model name', () => {
    expect(friendlyError(apiError(404, 'model: claude-opus-9 not found'))).toMatch(/^The model wasn't found/)
  })

  it('still reads a status the message spells out', () => {
    expect(friendlyError(new Error('Request failed with status code 401'))).toMatch(/rejected the API key/)
    expect(friendlyError(new Error('429 Too Many Requests'))).toMatch(/rate limiting/)
  })

  /** What a real call through Dalliance Cloud throws when the proxy answers with this status and message. */
  async function cloudRefusal(status: number, message: string) {
    const fetch = vi.fn(async () => Response.json({ error: { message, type: 'dalliance_account' } }, { status }))
    vi.stubGlobal('fetch', fetch)
    try {
      const model = cloudGateway({ baseURL: 'https://cloud.test/api/ai', signedIn: () => true, token: async () => 'jwt' })('anthropic/claude-fable-5.1')
      return await generateText({ model, prompt: 'Hi', maxRetries: 0 }).then(
        () => null,
        (err: unknown) => err,
      )
    } finally {
      vi.unstubAllGlobals()
    }
  }

  it("shows Dalliance Cloud's refusals as written, not as a rejected key", async () => {
    const offered = "This model doesn't run with zero data retention, so Dalliance Cloud doesn't offer it. Choose another model in Settings."
    expect(friendlyError(await cloudRefusal(403, offered))).toBe(offered)
    expect(friendlyError(await cloudRefusal(401, 'Sign in to Dalliance to run prompts.'))).toBe('Sign in to Dalliance to run prompts.')
    expect(friendlyError(await cloudRefusal(402, "You've used this period's credits."))).toBe("You've used this period's credits.")
  })

  it("explains Anthropic's refusal of a model that needs data retention", () => {
    const refused = apiError(400, 'invalid_request_error: your organization must have data retention enabled to use this model')
    expect(friendlyError(refused)).toMatch(/^This model needs data retention, and your Anthropic organization has zero data retention/)
    const viaGateway = new APICallError({ message: 'No zero data retention provider', url: 'https://ai-gateway.vercel.sh/v4/ai/language-model', requestBodyValues: {}, statusCode: 400 })
    expect(friendlyError(viaGateway)).toBe('No zero data retention provider')
  })

  it('reads a failed fetch as no connection', () => {
    const offline = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { code: 'ENOTFOUND' }) })
    expect(friendlyError(offline)).toMatch(/^Couldn't reach the model provider/)
    expect(friendlyError(apiError(undefined, 'Cannot connect to API: other side closed'))).toMatch(/^Couldn't reach the model provider/)
  })
})
