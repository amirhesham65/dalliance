import type { AccountView, BillingView, CellRunResult, DallianceApi, RunCellRequest, RunEvent, SettingsView } from '@dalliance/shared/ipc'
import type { Provenance } from '@dalliance/shared/notebook'

type RunHandler = (request: RunCellRequest, emit: (event: RunEvent) => void) => Promise<CellRunResult> | CellRunResult

/** A stand-in for the Electron bridge. Tests decide what each run returns. */
export function fakeApi(onRun: RunHandler) {
  const runListeners = new Set<(cellId: string, event: RunEvent) => void>()
  const requests: RunCellRequest[] = []
  const responses: [string, unknown][] = []
  const api: DallianceApi = {
    platform: 'darwin',
    runCell: async (request) => {
      requests.push(request)
      return onRun(request, (event) => runListeners.forEach((l) => l(request.cellId, event)))
    },
    onRunEvent: (l) => {
      runListeners.add(l)
      return () => runListeners.delete(l)
    },
    respond: (id, answer) => responses.push([id, answer]),
    interrupt: async () => {},
    restartKernel: async () => {},
    kernelState: async () => ({ status: 'idle', python: '3.12.0', cwd: '/tmp', error: null }),
    listVariables: async () => [{ name: 'orders', type: 'DataFrame', shape: '10 × 2', detail: '' }],
    listPackages: async () => ({
      python: '/usr/bin/python3',
      version: '3.12.0',
      packages: [
        { name: 'numpy', version: '2.1.0' },
        { name: 'pandas', version: '2.2.3' },
      ],
      error: null,
    }),
    onKernelState: () => () => {},
    getSettings: async () => fakeSettings(),
    listModels: async () => ({
      provider: 'gateway',
      models: [
        { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', maker: 'Anthropic', price: '$2 / $10' },
        { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', maker: 'Anthropic', price: '$5 / $25' },
        { id: 'openai/gpt-5.2', name: 'GPT-5.2', maker: 'OpenAI', price: '$1.75 / $14' },
        { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', maker: 'Google', price: '$2 / $12' },
      ],
      error: null,
    }),
    checkKey: async () => ({ status: 'ok', detail: '$5.00 in credits' }),
    updateSettings: async () => {
      throw new Error('not used')
    },
    pythonState: async () => ({ python: '/usr/bin/python3', version: '3.12.0', source: 'system', managedEnvExists: false, missingPackages: [] }),
    setupPython: async () => {
      throw new Error('not used')
    },
    onPythonLog: () => () => {},
    openNotebook: async () => null,
    newNotebook: async (notebook) => ({ path: '/tmp/Untitled.ipynb', notebook }),
    openFolder: async () => null,
    openRecent: async () => null,
    recentNotebooks: async () => [],
    readBrief: async () => ({ path: '/tmp/AGENTS.md', text: null }),
    writeBrief: async (text) => ({ path: '/tmp/AGENTS.md', text }),
    listFiles: async () => [],
    renameNotebook: async (current, name) => ({ path: `${(current ?? '/tmp/x.ipynb').replace(/[^/]*$/, '')}${name}.ipynb`, saved: current == null }),
    saveNotebook: async (_path, notebook) => ({ path: '/tmp/test.ipynb', pins: notebook.pins ?? null }),
    checkPins: async () => [],
    confirmDiscard: async () => true,
    restoreSession: async () => null,
    saveDraft: () => {},
    setDocumentState: () => {},
    onMenu: () => () => {},
    getAccount: async () => SIGNED_OUT,
    signIn: async () => SIGNED_OUT,
    redeemSignInCode: async () => SIGNED_OUT,
    signOut: async () => SIGNED_OUT,
    onAccount: () => () => {},
    getBilling: async () => NO_BILLING,
    startCheckout: async () => NO_BILLING,
    openBillingPortal: async () => NO_BILLING,
    onBilling: () => () => {},
    countCredits: async () => null,
  }
  return { api, requests, responses }
}

export function fakeSettings(): SettingsView {
  return {
    provider: 'gateway',
    model: 'anthropic/claude-sonnet-5.5',
    effort: 'medium',
    pythonPath: null,
    approvalMode: 'interactive',
    autoTitles: true,
    suggestNext: true,
    showCosts: false,
    onboarded: true,
    keySource: 'environment',
    hasKey: { gateway: true, anthropic: false },
    cloud: false,
  }
}

/** What a build without Dalliance Cloud answers. */
const SIGNED_OUT: AccountView = { user: null, checking: false, waiting: false, error: null }
const NO_BILLING: BillingView = { available: false, plans: [], subscription: null, usage: null, loading: false, checkingOut: false, error: null }

export function result(overrides: Partial<CellRunResult> = {}): CellRunResult {
  return {
    ok: true,
    code: 'x = 1\nx',
    outputs: [{ type: 'text', text: '1' }],
    executionCount: 1,
    durationMs: 12,
    generated: true,
    interpretation: null,
    answer: null,
    suggestions: [],
    variables: [],
    activity: [],
    steps: [],
    error: null,
    ...overrides,
  }
}

/** The record of how a cell was made, as a generation returns it: two attempts, the second one working. */
export function provenance(overrides: Partial<Provenance> = {}): Provenance {
  return {
    prompt: 'Average order value',
    corrections: [],
    madeAt: '2026-09-30T14:05:00.000Z',
    model: 'anthropic/claude-sonnet-5.5',
    effort: 'medium',
    steps: [1, 2, 3].map((step) => ({ step, model: 'anthropic/claude-sonnet-5.5', fallback: false })),
    rationale: { from: 'summaries', text: ['The column is total, not amount.'] },
    attemptCount: 2,
    attempts: [
      { code: 'orders.amount.mean()', error: "KeyError: 'amount'", changed: null },
      { code: 'orders.total.mean()', error: null, changed: '- orders.amount.mean()\n+ orders.total.mean()' },
    ],
    filesRead: [
      { path: 'orders.csv', by: 'code' },
      { path: 'README.md', by: 'agent' },
    ],
    filesReadTruncated: false,
    approvals: [{ kind: 'packages', detail: 'pip install seaborn', outcome: 'approved' }],
    codeHash: `sha256:${'c'.repeat(64)}`,
    outputsHash: `sha256:${'d'.repeat(64)}`,
    ...overrides,
  }
}
