import type { Output } from '../../src/shared/notebook'
import type { ExecuteOptions, ExecuteResult, Kernel, KernelInfo, VariableInfo } from './kernel'

type Handler = (code: string) => { ok: boolean; outputs: Output[]; assigned?: VariableInfo[] }

/** In-memory kernel for tests. Each execute() is answered by the handler you pass in. */
export class FakeKernel implements Kernel {
  executed: { code: string; store: boolean }[] = []
  vars: VariableInfo[] = []
  private count = 0
  private readonly handler: Handler

  constructor(handler: Handler = () => ({ ok: true, outputs: [] })) {
    this.handler = handler
  }

  info(): KernelInfo {
    return { status: 'idle', python: '3.12.0', executable: '/fake/python', cwd: '/fake', error: null }
  }

  async execute(code: string, options: ExecuteOptions): Promise<ExecuteResult> {
    this.executed.push({ code, store: options.store })
    const { ok, outputs, assigned = [] } = this.handler(code)
    for (const o of outputs) options.onOutput?.(o)
    return { ok, outputs, executionCount: options.store ? ++this.count : null, durationMs: 5, assigned: options.store ? assigned : [] }
  }

  async variables() {
    return this.vars
  }

  interrupt() {}
  async restart() {
    this.count = 0
  }
  async shutdown() {}
}
