import type { Output, PinnedPackage } from '@dalliance/shared/notebook'
import type { ExecuteOptions, ExecuteResult, Kernel, KernelEnvironment, KernelInfo, VariableInfo } from './kernel'

type Handler = (code: string) => { ok: boolean; outputs: Output[]; assigned?: VariableInfo[]; filesRead?: string[] }

/** In-memory kernel for tests. Each execute() is answered by the handler you pass in. */
export class FakeKernel implements Kernel {
  executed: { code: string; store: boolean }[] = []
  vars: VariableInfo[] = []
  /** What environment() reports the executes imported. */
  packages: PinnedPackage[] = []
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
    const { ok, outputs, assigned = [], filesRead = [] } = this.handler(code)
    for (const o of outputs) options.onOutput?.(o)
    return {
      ok,
      outputs,
      executionCount: options.store ? ++this.count : null,
      durationMs: 5,
      assigned: options.store ? assigned : [],
      filesRead: { paths: filesRead, truncated: false },
    }
  }

  async variables() {
    return this.vars
  }

  async environment(): Promise<KernelEnvironment> {
    return { python: this.info().python ?? '', packages: this.packages }
  }

  interrupt() {}
  async restart() {
    this.count = 0
  }
  async shutdown() {}
}
