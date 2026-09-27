/**
 * Lifecycle events around tool calls (course module 11). Extensions subscribe;
 * a tool_call handler can block the call, and its reason goes back to the model as the result.
 */
export type HarnessEvent = 'run_start' | 'tool_call' | 'tool_result' | 'run_end'

export interface EventData {
  cellId: string
  toolName?: string
  input?: unknown
  output?: unknown
  ok?: boolean
  error?: string
}

export type EventResult = { block: true; reason: string } | void

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
  async emit(event: HarnessEvent, data: EventData): Promise<{ blocked: boolean; reason?: string }> {
    for (const handler of this.handlers.get(event) ?? []) {
      const result = await handler(data)
      if (result && result.block) return { blocked: true, reason: result.reason }
    }
    return { blocked: false }
  }
}
