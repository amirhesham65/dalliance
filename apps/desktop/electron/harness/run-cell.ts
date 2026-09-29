import { type LanguageModel, ToolLoopAgent, type ToolLoopAgentSettings, stepCountIs } from 'ai'
import type { ActivityItem, CellRunResult, RunCellRequest, RunEvent } from '@dalliance/shared/ipc'
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
  emit: (event: RunEvent) => void
  askUser: (question: string, options: string[]) => Promise<string | null>
  requestApproval: (title: string, detail: string) => Promise<boolean>
  needsApproval: (packages: string[]) => boolean
  installPackages: (packages: string[]) => Promise<string>
  signal: AbortSignal
  exploreTimeoutMs?: number
  /** Upper bound on model steps for one cell. */
  maxSteps?: number
}

const TOOL_NAMES = ['list_variables', 'explore', 'list_files', 'read_file', 'run_cell', 'install_packages', 'ask_user', 'finish'] as const

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
  })

  const agent = new ToolLoopAgent<never, CellTools>({
    model: deps.model,
    // Stable behaviour first, marked for caching. Per-cell context goes in the prompt below.
    instructions: {
      role: 'system',
      content: buildSystemPrompt({
        pythonVersion: deps.pythonVersion,
        toolNames: [...TOOL_NAMES],
        projectInstructions: deps.projectInstructions,
        modelId: deps.modelId,
      }),
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    tools,
    toolOrder: [...TOOL_NAMES],
    providerOptions: deps.providerOptions,
    // History stays append-only: with thinking on, the API rejects any change to earlier turns,
    // so there's no pruning here. The step cap and bounded tool outputs keep a run small instead.
    stopWhen: [stepCountIs(deps.maxSteps ?? 24), () => state.finished != null],
  })

  const prompt = buildCellPrompt({
    prompt: request.prompt,
    variables: formatVariables(variables),
    files,
    previousCells: request.previousCells,
    existingCode: request.code.trim() ? request.code : null,
    corrections: request.corrections,
  })

  let text = ''
  let error: string | null = null
  try {
    const result = await agent.stream({ prompt, abortSignal: deps.signal })
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text
          break
        case 'tool-call': {
          const label = describeCall(part.toolName, part.input)
          track({ id: part.toolCallId, label, status: 'running' })
          deps.emit({ type: 'status', text: label })
          break
        }
        case 'tool-result': {
          const prev = activity.get(part.toolCallId)
          const outcome = describeResult(part.toolName, part.output)
          track({
            id: part.toolCallId,
            label: outcome.label ?? prev?.label ?? part.toolName,
            detail: outcome.detail,
            status: outcome.failed ? 'error' : 'done',
          })
          deps.emit({ type: 'status', text: 'Thinking' })
          break
        }
        case 'tool-error': {
          const prev = activity.get(part.toolCallId)
          track({ id: part.toolCallId, label: prev?.label ?? part.toolName, detail: errorMessage(part.error), status: 'error' })
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
    suggestions: state.finished?.suggestions ?? [],
    activity: [...activity.values()],
    error,
  }
}

const created = (vars: { name: string; type: string; shape: string }[]) => vars.map(({ name, type, shape }) => ({ name, type, shape }))

/** Per-tool rendering, as in the course's streaming lesson: a short label for each call. */
export function describeCall(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'list_variables':
      return 'Checking variables'
    case 'explore':
      return `Looking at ${firstLine(String(i.code ?? ''))}`
    case 'list_files':
      return 'Listing files'
    case 'read_file':
      return `Reading ${String(i.path ?? 'a file')}`
    case 'run_cell':
      return 'Running the cell'
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

function describeResult(toolName: string, output: unknown): { label?: string; detail?: string; failed?: boolean } {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (text.startsWith('Blocked:')) return { detail: text, failed: true }
  switch (toolName) {
    case 'list_variables':
      return { label: 'Checked variables' }
    case 'list_files':
      return { label: 'Listed files' }
    case 'run_cell':
      return text.startsWith('The cell failed')
        ? { label: 'Ran the cell', detail: firstLine(text.split('\n')[1] ?? ''), failed: true }
        : { label: 'Ran the cell', detail: text.match(/in (\d+) ms/)?.[0] }
    case 'install_packages':
      return text.startsWith('The user declined') ? { label: 'Install declined', failed: true } : { label: firstLine(text) }
    case 'ask_user':
      return { label: firstLine(text.replace('The user answered: ', 'You answered: ')) }
    case 'finish':
      return text === 'Done.' ? { label: 'Finished' } : { label: 'Tried to finish early', detail: text }
    case 'explore':
      return text.includes('Error:') ? { detail: firstLine(text), failed: false } : {}
    default:
      return {}
  }
}

const firstLine = (s: string) => clip(s.trim().split('\n')[0] ?? '', 80)
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function friendlyError(err: unknown): string {
  const message = errorMessage(err)
  // Ollama's own messages come first: a plan that lacks a model answers 403, which would read as a bad key
  if (/subscription|upgrade|requires? (a )?(paid )?plan/i.test(message)) return "Your Ollama plan doesn't include this model. Pick another in the model picker, or upgrade at ollama.com."
  if (/11434|ECONNREFUSED/i.test(message)) return "Ollama isn't running on this Mac. Open the Ollama app, then run the cell again."
  if (/try pulling it first/i.test(message)) return `Ollama doesn't have that model yet. Run "ollama pull" for it, or pick one that is pulled. (${clip(message, 160)})`
  if (/does not support tools/i.test(message)) return "This model can't call tools, which the agent needs. Pick another model."
  if (/api key|unauthorized|authentication|401|403/i.test(message)) return `The model provider rejected the API key. Check it in Settings. (${clip(message, 200)})`
  if (/rate limit|429/i.test(message)) return 'The model provider is rate limiting requests. Try again in a minute.'
  if (/not found|404/i.test(message) && /model/i.test(message)) return `The model wasn't found. Check the model name in Settings. (${clip(message, 200)})`
  return clip(message, 400)
}
