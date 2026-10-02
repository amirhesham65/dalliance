/**
 * Lifecycle events around tool calls (course module 11). Extensions subscribe;
 * a tool_call handler can block the call, and its reason goes back to the model as the result.
 */
export type HarnessEvent = 'run_start' | 'tool_call' | 'tool_result' | 'step' | 'run_end'

/** A request for a person to allow something, answered by the same policy as package installs. */
export interface ApprovalRequest {
  title: string
  detail: string
  /** What approving trusts for the rest of the session: package names, or `code:shell` and `code:network`. */
  keys: string[]
}

/** Token counts for one model call. Undefined where the provider doesn't report them. */
export interface StepUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface EventData {
  cellId: string
  toolName?: string
  input?: unknown
  output?: unknown
  ok?: boolean
  error?: string
  /**
   * On tool_call: asks the approval policy, and a person when the policy says so. Resolves true when allowed.
   * JSON drops functions, so the log never sees it.
   */
  approve?: (request: ApprovalRequest) => Promise<boolean>
  /** On step: which model call of the run this was, from 1. */
  step?: number
  /** On step: the model that answered. */
  modelId?: string
  /** On step: the model's reasoning summary, null when it returned none. Never clipped in the log. */
  reasoning?: string | null
  /** On step: why the model stopped, like `tool-calls` or `stop`. */
  finishReason?: string
  /** On step: wall time from the request to the end of the step's tool calls. */
  durationMs?: number
  usage?: StepUsage
}

/** A block. `secret` is set when the call touched something that may hold secrets: the file or the line, for the cell's record. */
export type EventResult = { block: true; reason: string; secret?: string } | void

type Handler = (data: EventData) => Promise<EventResult> | EventResult

export class EventBus {
  private handlers = new Map<HarnessEvent, Handler[]>()

  on(event: HarnessEvent, handler: Handler): () => void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return () => this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler))
  }

  /** Runs handlers in registration order and stops at the first block. */
  async emit(event: HarnessEvent, data: EventData): Promise<{ blocked: boolean; reason?: string; secret?: string }> {
    for (const handler of this.handlers.get(event) ?? []) {
      const result = await handler(data)
      if (result && result.block) return { blocked: true, reason: result.reason, ...(result.secret != null ? { secret: result.secret } : {}) }
    }
    return { blocked: false }
  }
}
