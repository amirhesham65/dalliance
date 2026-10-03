// @vitest-environment node
/**
 * End-to-end: real Python environment, real kernel, real model. The model is called on the AI Gateway directly with
 * AI_GATEWAY_API_KEY, the way Dalliance Cloud's proxy calls it, so the test needs no account.
 * Costs money and needs the network, so it only runs with DALLIANCE_E2E=1:
 *   DALLIANCE_E2E=1 pnpm exec vitest run electron/e2e.test.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createGateway } from '@ai-sdk/gateway'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RunCellRequest, RunEvent } from '@dalliance/shared/ipc'
import { createApproval } from './harness/approval'
import { EventBus } from './harness/events'
import { DEFAULT_MODEL, agentProviderOptions } from './harness/model'
import { type HarnessDeps, runCell } from './harness/run-cell'
import { setupManagedEnv } from './kernel/python-env'
import { PythonKernel } from './kernel/python-kernel'

if (existsSync('.env')) process.loadEnvFile('.env')
const enabled = process.env.DALLIANCE_E2E === '1' && Boolean(process.env.AI_GATEWAY_API_KEY)

describe.skipIf(!enabled)('end to end', () => {
  const root = path.join(tmpdir(), 'dalliance-e2e')
  const workspace = path.join(root, 'workspace')
  let kernel: PythonKernel
  let deps: Omit<HarnessDeps, 'emit'>
  const previous: RunCellRequest['previousCells'] = []

  beforeAll(async () => {
    mkdirSync(workspace, { recursive: true })
    const rows = ['order_id,month,plan,total']
    const months = ['2026-06', '2026-07', '2026-08']
    let id = 1
    for (const month of months)
      for (const plan of ['Starter', 'Pro', 'Team'])
        for (let i = 0; i < 4; i++) rows.push(`${id++},${month},${plan},${(20 + (id * 7) % 60).toFixed(2)}`)
    writeFileSync(path.join(workspace, 'orders.csv'), `${rows.join('\n')}\n`)

    const python = await setupManagedEnv(path.join(root, 'env'), () => {})
    kernel = new PythonKernel({ python, cwd: workspace, scratchDir: path.join(root, 'kernel') })
    await kernel.start()
    const modelId = process.env.DALLIANCE_E2E_MODEL ?? DEFAULT_MODEL
    const model = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY! })(modelId)
    const providerOptions = agentProviderOptions({ model: modelId, effort: 'low' })
    deps = {
      model,
      providerOptions,
      kernel,
      workspaceDir: workspace,
      bus: new EventBus(),
      pythonVersion: kernel.info().python,
      projectInstructions: null,
      askUser: async (_q, options) => options[0],
      requestApproval: async () => false,
      needsApproval: createApproval({ mode: 'interactive' }),
      installPackages: async () => '',
      signal: new AbortController().signal,
    }
  }, 300_000)

  afterAll(() => kernel?.shutdown())

  async function run(prompt: string, code = '', generate = true) {
    const events: RunEvent[] = []
    const result = await runCell(
      { cellId: `c${previous.length}`, prompt, code, generate, corrections: [], previousCells: [...previous] },
      { ...deps, emit: (e) => events.push(e) },
    )
    console.log(`\n# ${prompt}\n${result.activity.map((a) => `  ${a.status === 'error' ? 'x' : '-'} ${a.label}${a.detail ? ` (${a.detail})` : ''}`).join('\n')}\n--- code\n${result.code}\n--- answer: ${result.answer}\n--- interpretation: ${result.interpretation}\n--- outputs: ${result.outputs.map((o) => o.type).join(', ')}\n--- error: ${result.error}`)
    if (result.ok) previous.push({ kind: 'prompt', text: prompt, code: result.code })
    return { result, events }
  }

  it('loads a CSV into a named variable', async () => {
    const { result } = await run('Load orders.csv')
    expect(result.error).toBeNull()
    expect(result.ok).toBe(true)
    expect(result.outputs.some((o) => o.type === 'table')).toBe(true)
    const vars = await kernel.variables()
    expect(vars.some((v) => v.type === 'DataFrame')).toBe(true)
  }, 240_000)

  it('answers a question with a chart and numbers from the data', async () => {
    const { result, events } = await run('Which plan brought in the most revenue in August? Chart revenue by plan per month.')
    expect(result.ok).toBe(true)
    expect(result.outputs.some((o) => o.type === 'image')).toBe(true)
    expect(result.answer).toBeTruthy()
    expect(events.some((e) => e.type === 'activity')).toBe(true)
  }, 240_000)

  it('looks at an image file to answer', async () => {
    // A picture of a number only seeing it can read: no text file or variable holds it
    await kernel.execute("import matplotlib.pyplot as plt\nfig = plt.figure(figsize=(4, 2))\nfig.text(0.5, 0.5, '7319', fontsize=60, ha='center', va='center')\nfig.savefig('sign.png')\nplt.close('all')", { store: false })
    const { result } = await run('What number is written on sign.png?')
    expect(result.ok).toBe(true)
    expect(result.activity.some((a) => a.label === 'Looked at sign.png')).toBe(true)
    expect(result.answer).toContain('7319')
  }, 240_000)

  it('reruns the saved code directly, without the model', async () => {
    const code = previous[0].code!
    const { result } = await run('Load orders.csv', code, false)
    expect(result).toMatchObject({ ok: true, generated: false })
  }, 60_000)
})
