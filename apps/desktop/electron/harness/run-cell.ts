import { GatewayError } from '@ai-sdk/gateway'
import {
  APICallError,
  type LanguageModel,
  type ProviderMetadata,
  RetryError,
  ToolLoopAgent,
  type ToolLoopAgentSettings,
  parsePartialJson,
  stepCountIs,
} from 'ai'
import type { ActivityItem, CellRunResult, RunCellRequest, RunEvent, RunStep } from '@dalliance/shared/ipc'
import type { Output } from '@dalliance/shared/notebook'
import type { Kernel } from '../kernel/kernel'
import type { EventBus } from './events'
import { clip, formatVariables } from './format'
import { buildCellPrompt, buildSystemPrompt } from './prompt'
import { type CellTools, type RunState, createCellTools } from './tools'
import { listFiles } from './workspace'

export interface HarnessDeps {
  model: LanguageModel
  providerOptions?: ToolLoopAgentSettings['providerOptions']
  kernel: Kernel
  workspaceDir: string
  bus: EventBus
  pythonVersion: string | null
  projectInstructions: string | null
  modelId?: string | null
  /** Whether to ask for suggested next prompts. On unless the user turned them off. */
  suggestNext?: boolean
  emit: (event: RunEvent) => void
  askUser: (question: string, options: string[]) => Promise<string | null>
  /** Asks a person. `keys` are what approving trusts for the rest of the session. */
  requestApproval: (title: string, detail: string, keys: string[]) => Promise<boolean>
  /** The approval policy, from createApproval(). */
  needsApproval: (keys: string[]) => boolean
  installPackages: (packages: string[]) => Promise<string>
  signal: AbortSignal
  exploreTimeoutMs?: number
  /** How long one run_cell may take before the kernel is interrupted. Defaults to 10 minutes. */
  runTimeoutMs?: number
  /** Upper bound on model steps for one cell. */
  maxSteps?: number
}

const TOOL_NAMES = ['list_variables', 'explore', 'list_files', 'read_file', 'run_cell', 'install_packages', 'ask_user', 'finish'] as const
/** Tools whose input starts with a summary for the user, which becomes the step's label. */
const SUMMARIZED = new Set(['explore', 'run_cell'])
/** How much of a call's code an activity item keeps. The Code tab has the whole cell. */
const MAX_ACTIVITY_CODE = 4000

/** Run a cell. With request.generate the agent writes the code; otherwise the existing code runs as is. */
export async function runCell(request: RunCellRequest, deps: HarnessDeps): Promise<CellRunResult> {
  return request.generate ? generateCell(request, deps) : executeCell(request, deps)
}

async function executeCell(request: RunCellRequest, deps: HarnessDeps): Promise<CellRunResult> {
  deps.emit({ type: 'status', text: 'Running' })
  deps.emit({ type: 'attempt', code: request.code })
  const result = await deps.kernel.execute(request.code, { store: true, onOutput: (o) => deps.emit({ type: 'output', output: o }) })
  return {
    ok: result.ok,
    code: request.code,
    outputs: result.outputs,
    executionCount: result.executionCount,
    durationMs: result.durationMs,
    generated: false,
    interpretation: null,
    answer: null,
    suggestions: [],
    variables: created(result.assigned),
    activity: [],
    steps: [],
    error: null,
  }
}

async function generateCell(request: RunCellRequest, deps: HarnessDeps): Promise<CellRunResult> {
  const started = Date.now()
  const state: RunState = { lastRun: null, finished: null, attempts: 0 }
  const activity = new Map<string, ActivityItem>()
  const track = (item: ActivityItem) => {
    activity.set(item.id, item)
    deps.emit({ type: 'activity', item })
  }

  deps.emit({ type: 'status', text: 'Reading the notebook' })
  await deps.bus.emit('run_start', { cellId: request.cellId, input: request.prompt })

  const [variables, files] = await Promise.all([deps.kernel.variables().catch(() => []), listFiles(deps.workspaceDir, 80)])

  const tools = createCellTools({
    cellId: request.cellId,
    kernel: deps.kernel,
    workspaceDir: deps.workspaceDir,
    bus: deps.bus,
    state,
    onAttempt: (code) => deps.emit({ type: 'attempt', code }),
    onOutput: (output: Output) => deps.emit({ type: 'output', output }),
    askUser: deps.askUser,
    requestApproval: deps.requestApproval,
    needsApproval: deps.needsApproval,
    installPackages: deps.installPackages,
    exploreTimeoutMs: deps.exploreTimeoutMs,
    runTimeoutMs: deps.runTimeoutMs,
  })

  const agent = new ToolLoopAgent<never, CellTools>({
    model: deps.model,
    // Stable behaviour first, marked for caching. Per-cell context goes in the prompt below.
    instructions: {
      role: 'system',
      content: buildSystemPrompt({
        pythonVersion: deps.pythonVersion,
        toolNames: [...TOOL_NAMES],
        modelId: deps.modelId,
      }),
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    tools,
    toolOrder: [...TOOL_NAMES],
    // For Anthropic this carries a top-level cacheControl (see agentProviderOptions), which caches the growing
    // history at the last block of each step without marking any message
    providerOptions: deps.providerOptions,
    // History stays append-only: with thinking on, the API rejects any change to earlier turns,
    // so there's no pruning here. The step cap and bounded tool outputs keep a run small instead.
    stopWhen: [stepCountIs(deps.maxSteps ?? 24), () => state.finished != null],
  })

  const prompt = buildCellPrompt({
    prompt: request.prompt,
    projectInstructions: deps.projectInstructions,
    variables: formatVariables(variables),
    files,
    previousCells: request.previousCells,
    existingCode: request.code.trim() ? request.code : null,
    corrections: request.corrections,
    suggestNext: deps.suggestNext,
  })

  let text = ''
  let error: string | null = null
  let step = 0
  let stepStarted = Date.now()
  const steps: RunStep[] = []
  // The reasoning summary of the step under way, from its reasoning parts
  let reasoning = ''
  // The input of each explore or run_cell call as it streams in, until its summary can be read
  const drafts = new Map<string, string>()
  const malformed = new Set<string>()
  try {
    const result = await agent.stream({ prompt, abortSignal: deps.signal })
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          step += 1
          stepStarted = Date.now()
          reasoning = ''
          break
        case 'reasoning-delta':
          reasoning += part.text
          break
        case 'finish-step': {
          const { usage } = part
          const served = servedByFallback(part.providerMetadata)
          const record: RunStep = {
            step,
            modelId: served.model || part.response.modelId || deps.modelId || null,
            fallback: served.fallback,
            reasoning: reasoning.trim() || null,
          }
          steps.push(record)
          await deps.bus.emit('step', {
            cellId: request.cellId,
            step,
            modelId: record.modelId ?? undefined,
            fallback: record.fallback,
            reasoning: record.reasoning,
            finishReason: part.finishReason,
            durationMs: Date.now() - stepStarted,
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
              cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
              reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
            },
          })
          break
        }
        case 'text-delta':
          text += part.text
          break
        // The step shows as soon as the model starts the call, with a generic label until the summary streams in
        case 'tool-input-start': {
          const label = describeCall(part.toolName, {})
          track({ id: part.id, label, status: 'running' })
          deps.emit({ type: 'status', text: label })
          if (SUMMARIZED.has(part.toolName)) drafts.set(part.id, '')
          break
        }
        case 'tool-input-delta': {
          const draft = drafts.get(part.id)
          if (draft == null) break
          const input = draft + part.delta
          drafts.set(part.id, input)
          const summary = await streamedSummary(input)
          if (!summary) break
          drafts.delete(part.id)
          track({ id: part.id, label: summary, status: 'running' })
          deps.emit({ type: 'status', text: summary })
          break
        }
        // The whole input is in: confirm the label from it, and keep the code behind it
        case 'tool-call': {
          drafts.delete(part.toolCallId)
          // An input that failed its schema, such as one without a summary. A tool-error follows.
          if (part.invalid) malformed.add(part.toolCallId)
          const label = describeCall(part.toolName, part.input)
          track({ id: part.toolCallId, label, code: codeOf(part.toolName, part.input), status: 'running' })
          deps.emit({ type: 'status', text: label })
          break
        }
        case 'tool-result': {
          const prev = activity.get(part.toolCallId)
          const outcome = describeResult(part.toolName, part.output, part.input)
          track({
            id: part.toolCallId,
            label: outcome.label ?? prev?.label ?? part.toolName,
            detail: outcome.detail,
            code: prev?.code,
            status: outcome.failed ? 'error' : 'done',
          })
          deps.emit({ type: 'status', text: 'Thinking' })
          break
        }
        case 'tool-error': {
          const prev = activity.get(part.toolCallId)
          // The error of a malformed call quotes the whole input, code and all
          const detail = malformed.has(part.toolCallId) ? 'The call was malformed and went back to the model' : errorMessage(part.error)
          track({ id: part.toolCallId, label: prev?.label ?? part.toolName, detail, code: prev?.code, status: 'error' })
          break
        }
        case 'error':
          throw part.error
      }
    }
  } catch (err) {
    error = deps.signal.aborted ? 'Stopped.' : friendlyError(err)
  }
  // An aborted stream can end without throwing
  if (deps.signal.aborted) error = 'Stopped.'
  // A call cut off by a stop or an error never gets a result. Don't leave it spinning.
  for (const item of activity.values()) if (item.status === 'running') track({ ...item, status: 'error' })

  await deps.bus.emit('run_end', { cellId: request.cellId, ok: error == null && state.finished != null, error: error ?? undefined })

  const last = state.lastRun
  const answeredInWords = state.finished != null && last == null
  const succeeded = last?.result.ok === true || answeredInWords
  if (!error && !succeeded) {
    error = last
      ? `The code still failed after ${state.attempts} ${state.attempts === 1 ? 'try' : 'tries'}. The last attempt is in the Code tab.`
      : clip(text.trim(), 600) || 'The agent stopped without running any code.'
  }

  return {
    ok: error == null && succeeded,
    code: answeredInWords ? '' : (last?.code ?? request.code),
    outputs: last?.result.outputs ?? [],
    executionCount: last?.result.executionCount ?? null,
    durationMs: Date.now() - started,
    generated: true,
    interpretation: state.finished?.interpretation ?? null,
    variables: created(last?.result.assigned ?? []),
    // If the model answered in text instead of calling finish, keep that answer
    answer: state.finished?.answer ?? (succeeded && text.trim() ? clip(text.trim(), 1200) : null),
    // A model may still write some after being told not to
    suggestions: deps.suggestNext === false ? [] : (state.finished?.suggestions ?? []),
    activity: [...activity.values()],
    steps,
    error,
  }
}

/**
 * Whether a server-side fallback answered a call the chosen model declined, and which model it was. Anthropic
 * reports one in its usage iterations as a `fallback_message`, the last one being the model that served the turn.
 */
export function servedByFallback(metadata: ProviderMetadata | undefined): { fallback: boolean; model: string | null } {
  const iterations = metadata?.anthropic?.iterations
  const served = Array.isArray(iterations)
    ? (iterations.filter((i) => (i as { type?: unknown } | null)?.type === 'fallback_message').at(-1) as { model?: unknown } | undefined)
    : undefined
  if (!served) return { fallback: false, model: null }
  return { fallback: true, model: typeof served.model === 'string' ? served.model : null }
}

const created = (vars: { name: string; type: string; shape: string }[]) => vars.map(({ name, type, shape }) => ({ name, type, shape }))

/** Per-tool rendering, as in the course's streaming lesson: a short label for each call. Labels are words, never code. */
export function describeCall(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'list_variables':
      return 'Checking variables'
    case 'explore':
      return summaryOf(i) ?? 'Exploring the data'
    case 'list_files':
      return 'Listing files'
    case 'read_file':
      return `Reading ${String(i.path ?? 'a file')}`
    case 'run_cell':
      return summaryOf(i) ?? 'Running the cell'
    case 'install_packages':
      return `Installing ${(i.packages as string[] | undefined)?.join(', ') ?? 'packages'}`
    case 'ask_user':
      return 'Waiting for your answer'
    case 'finish':
      return 'Finishing'
    default:
      return toolName
  }
}

/**
 * How a call ended. A step keeps the summary it ran under, or gets a past-tense generic label without one.
 * A detail is a duration or the one line of an error, never a line of code or traceback.
 */
export function describeResult(toolName: string, output: unknown, input?: unknown): { label?: string; detail?: string; failed?: boolean } {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (text.startsWith('Blocked:')) return { detail: text, failed: true }
  const summarized = summaryOf((input ?? {}) as Record<string, unknown>) != null
  switch (toolName) {
    case 'list_variables':
      return { label: 'Checked variables' }
    case 'list_files':
      return { label: 'Listed files' }
    case 'run_cell': {
      const label = summarized ? undefined : 'Ran the cell'
      if (text.startsWith('The cell timed out')) return { label, detail: `Stopped after ${text.match(/after ([^.]+) and/)?.[1] ?? 'too long'}`, failed: true }
      if (text.startsWith('The cell failed')) return { label, detail: errorLine(text) ?? 'The cell failed', failed: true }
      const ms = text.match(/in (\d+) ms/)?.[1]
      return { label, detail: ms ? `Ran in ${ms} ms` : undefined }
    }
    case 'install_packages':
      return text.startsWith('The user declined') ? { label: 'Install declined', failed: true } : { label: firstLine(text) }
    case 'ask_user':
      return { label: firstLine(text.replace('The user answered: ', 'You answered: ')) }
    case 'finish':
      return text === 'Done.' ? { label: 'Finished' } : { label: 'Tried to finish early', detail: text }
    case 'explore':
      // An exploration that raised still did its job of looking, so it isn't a failed step
      return { label: summarized ? undefined : 'Explored the data', detail: errorLine(text) }
    default:
      return {}
  }
}

const firstLine = (s: string) => clip(s.trim().split('\n')[0] ?? '', 80)

/** The model's summary as a label: one line, without the full stop some models add. Null when there's none. */
function summaryOf(input: Record<string, unknown>): string | null {
  return typeof input.summary === 'string' ? firstLine(input.summary).replace(/[.…]+$/, '') || null : null
}

/**
 * The summary of a call still streaming, once it's whole. A string still being written parses as far as it got,
 * so the summary only counts once a later field has started, or the input is complete.
 */
async function streamedSummary(input: string): Promise<string | null> {
  if (!input.includes('"summary"')) return null
  const { value, state } = await parsePartialJson(input)
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const keys = Object.keys(fields)
  const whole = state === 'successful-parse' || (keys.includes('summary') && keys.at(-1) !== 'summary')
  return whole ? summaryOf(fields) : null
}

/** The code behind an explore or run_cell step, for the user to open. */
function codeOf(toolName: string, input: unknown): string | undefined {
  const code = SUMMARIZED.has(toolName) ? (input as { code?: unknown } | null)?.code : undefined
  return typeof code === 'string' && code.trim() ? clip(code, MAX_ACTIVITY_CODE) : undefined
}

/** The "Name: message" line of a Python error in a tool's output. A traceback around it quotes the code. */
function errorLine(text: string): string | undefined {
  const line = text.split('\n').find((l) => /^[A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit|Iteration): /.test(l))
  return line ? firstLine(line) : undefined
}
const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message
  // A provider's stream error can arrive as a plain object, like { type: 'overloaded_error', message: 'Overloaded' }
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(err)
}

/**
 * The HTTP status behind a failed call. AI SDK errors carry it as statusCode; after retries it sits on RetryError's
 * lastError. Without one, only a status the message spells out counts, like "status 401" or "429 Too Many Requests",
 * never a bare number that could be a token count.
 */
function statusOf(err: unknown): number | undefined {
  if (RetryError.isInstance(err)) return statusOf(err.lastError)
  if (APICallError.isInstance(err) || GatewayError.isInstance(err)) return err.statusCode
  const match = errorMessage(err).match(/\b(?:status(?: code)?|http(?:\/[\d.]+)?)[\s:=]*([1-5]\d\d)\b|\b([45]\d\d) (?:unauthorized|forbidden|not found|too many requests)\b/i)
  return match ? Number(match[1] ?? match[2]) : undefined
}

const NETWORK = /\b(?:fetch failed|cannot connect to api|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network error)\b/i

/**
 * A refusal from Dalliance Cloud's proxy: signed out, out of credits, a model it doesn't offer. Its message is
 * written for the user, so it's shown as is. The gateway provider wraps an error type it doesn't know, like the
 * proxy's `dalliance_account`, in a generic error, so the proxy's own response is read from the cause.
 */
function accountRefusal(err: unknown): string | null {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (RetryError.isInstance(e)) e = e.lastError
    if (APICallError.isInstance(e) && e.responseBody) {
      try {
        const body = JSON.parse(e.responseBody) as { error?: { type?: unknown; message?: unknown } }
        if (body.error?.type === 'dalliance_account' && typeof body.error.message === 'string') return body.error.message
      } catch {
        // Not JSON, so not the proxy's
      }
    }
    e = e instanceof Error ? e.cause : null
  }
  return null
}

/**
 * Anthropic's own answer, on a direct key, when a model needs data retention and the key's organization has zero
 * data retention. Only from api.anthropic.com, so a gateway error that mentions retention keeps its own words.
 */
function needsRetention(err: unknown, status: number | undefined, message: string): boolean {
  const call = RetryError.isInstance(err) ? err.lastError : err
  return status === 400 && APICallError.isInstance(call) && /^https:\/\/api\.anthropic\.com\//.test(call.url) && /\bdata retention\b/i.test(message)
}

export function friendlyError(err: unknown): string {
  const refusal = accountRefusal(err)
  if (refusal) return refusal
  const message = errorMessage(err)
  const detail = clip(message, 200)
  const status = statusOf(err)
  if (needsRetention(err, status, message)) {
    return "This model needs data retention, and your Anthropic organization has zero data retention. Choose another model in Settings."
  }
  if (status === 401 || status === 403 || (status == null && /\b(?:invalid (?:x-)?api[ -]key|unauthorized|authentication (?:error|failed))\b/i.test(message))) {
    return `The model provider rejected the API key. Check it in Settings. (${detail})`
  }
  if (status === 429 || (status == null && /\brate[ -]limit/i.test(message))) return 'The model provider is rate limiting requests. Try again in a minute.'
  if ((status === 404 || (status == null && /\bnot found\b/i.test(message))) && /\bmodel\b/i.test(message)) return `The model wasn't found. Check the model name in Settings. (${detail})`
  if (status === 529 || /\boverloaded\b/i.test(message)) return 'The model provider is overloaded right now. Try again in a minute.'
  if (status != null && status >= 500) return `The model provider had a problem (${status}). Try again. (${detail})`
  if (status == null && NETWORK.test(`${message} ${causeCode(err)}`)) return `Couldn't reach the model provider. Check your internet connection. (${detail})`
  return clip(message, 400)
}

/** Node puts the network error code, like ENOTFOUND, on the cause of "fetch failed". */
function causeCode(err: unknown): string {
  const cause = err instanceof Error ? (err.cause as { code?: unknown } | undefined) : undefined
  return typeof cause?.code === 'string' ? cause.code : ''
}
