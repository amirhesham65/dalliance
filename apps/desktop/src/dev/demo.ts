/**
 * A pretend desktop bridge for looking at the UI in a plain browser: open the renderer with ?demo.
 * Nothing here runs inside Electron, where window.ilios is the real bridge.
 */
import { fakeApi, fakeSettings, result } from '@/test/fake-api'
import type { PythonState, RunEvent } from '@ilios/shared/ipc'
import { type Notebook, type Output, newNoteCell, newPromptCell } from '@ilios/shared/notebook'
import { actions, setApi, useNotebook } from '@/store/notebook-store'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ordersTable: Output = {
  type: 'table',
  columns: ['month', 'orders', 'revenue'],
  index: ['0', '1', '2', '3'],
  rows: [
    ['May', 612, 24_310.5],
    ['Jun', 701, 27_902.1],
    ['Jul', 688, 26_144.8],
    ['Aug', 862, 35_512.4],
  ],
  totalRows: 4,
}

function sampleNotebook(): Notebook {
  const now = Date.now()
  const load = {
    ...newPromptCell('Load orders.csv', "orders = pd.read_csv('orders.csv', parse_dates=['created_at'])\norders"),
    state: 'done' as const,
    executionCount: 1,
    durationMs: 412,
    answer: 'Loaded **2,863 orders** from May to August.',
    outputs: [{ type: 'text', text: '<DataFrame 2,863 rows × 7 columns>' } as Output],
    variables: [{ name: 'orders', type: 'DataFrame', shape: '2,863 × 7' }],
  }
  const monthly = {
    ...newPromptCell('Revenue and orders by month', "monthly = orders.groupby(orders.created_at.dt.strftime('%b')).agg(orders=('id','count'), revenue=('total','sum'))\nmonthly"),
    state: 'done' as const,
    executionCount: 2,
    durationMs: 8_420,
    interpretation: 'Revenue is [[total including tax]], grouped by [[order creation month]].',
    answer: 'August was the strongest month with **$35.5k** from **862 orders**, up 36% on July.',
    outputs: [ordersTable],
    showTables: true,
    suggestions: ['Plot monthly revenue as a bar chart', 'Why did August jump? Break it down by region', 'Average order value by month'],
    variables: [{ name: 'monthly', type: 'DataFrame', shape: '4 × 2' }],
  }
  monthly.history = [
    { at: now - 4 * 60_000, prompt: monthly.prompt, code: monthly.code, interpretation: monthly.interpretation, answer: monthly.answer, edited: false },
    {
      at: now - 26 * 60_000,
      prompt: 'Revenue by month',
      code: "monthly = orders.groupby(orders.created_at.dt.month).total.sum()\nmonthly",
      interpretation: null,
      answer: 'August had the most revenue.',
      edited: false,
    },
  ]
  const region = { ...newPromptCell('Top 5 regions by revenue in August', "orders[orders.created_at.dt.month == 8].groupby('region').total.sum().nlargest(5)"), state: 'stale' as const, executionCount: 3, outputs: [{ type: 'text', text: 'region\nWest    9,120.4\nSouth   8,702.2' } as Output] }
  // A question answered in words, with its steps run into a sentence the way models often write them
  const question = {
    ...newPromptCell('What could I build with this data to practise machine learning?', ''),
    state: 'done' as const,
    durationMs: 8_020,
    answer:
      'A **return-risk classifier** fits this data well: `orders` has a `returned` flag on 2,863 rows. A good path: 1) compare return rates by plan, region and order size, 2) fill the 41 missing regions, 3) fit a logistic regression with scikit-learn to predict `returned`, 4) check accuracy and which features matter most. It is small enough to iterate on quickly.\nIf you would rather predict a number, forecasting next month\'s revenue by region is the regression version of the same exercise.',
    suggestions: ['Return rate by plan and region', 'Fit a logistic regression on returned'],
  }
  return {
    cells: [
      newNoteCell(
        '# Summer sales review\nHow did orders and revenue move from **May to August**, and what drove the August jump?\n\n## Questions\n- Which *regions* grew fastest?\n- Did the `pro` plan pull revenue up, or order volume?\n- Is August a one-off? Compare with @orders from last year.',
      ),
      load,
      monthly,
      region,
      question,
      newPromptCell('Which customers ordered more than 5 times, and what did they buy most?'),
    ],
  }
}

/** `welcome` opens on the start page. `setup` is a first launch: no key, no Python, nothing recent. */
export function installDemo(mode: 'notebook' | 'welcome' | 'setup' = 'notebook') {
  const { api } = fakeApi(async (request, emit: (e: RunEvent) => void) => {
    if (!request.generate) {
      await wait(500)
      return result({ code: request.code, outputs: [ordersTable], generated: false })
    }
    if (request.nameIt) setTimeout(() => emit({ type: 'title', title: 'Customers with 5+ orders', prompt: request.prompt }), 900)
    const steps = [
      { id: 'a', label: 'Checked variables' },
      { id: 'b', label: 'Looking at orders.region.value_counts()' },
      { id: 'c', label: 'Ran the cell', detail: 'in 84 ms' },
    ]
    for (const s of steps) {
      emit({ type: 'status', text: s.label })
      emit({ type: 'activity', item: { ...s, status: 'running' } })
      await wait(700)
      emit({ type: 'activity', item: { ...s, status: 'done' } })
    }
    return result({
      code: "orders.groupby('region').total.sum().sort_values(ascending=False)",
      outputs: [ordersTable],
      answer: 'The **West** region led with **$9.1k**.',
      suggestions: ['Compare West and South week by week', 'Plot revenue by region'],
      activity: steps.map((s) => ({ ...s, status: 'done' as const })),
      durationMs: 2_300,
    })
  })
  const brief = { path: '/Users/demo/Summer sales/AGENTS.md', text: null as string | null }
  api.platform = 'darwin'
  api.readBrief = async () => ({ ...brief })
  api.writeBrief = async (text) => {
    brief.text = text
    return { ...brief }
  }
  api.listFiles = async () => [
    { path: 'orders.csv', size: '412.6 KB' },
    { path: 'customers.csv', size: '88.1 KB' },
    { path: 'regions/targets.xlsx', size: '19.4 KB' },
  ]
  api.recentNotebooks = async () => [
    { path: '/Users/demo/Summer sales/review.ipynb', name: 'review', folder: 'Summer sales', openedAt: Date.now() - 60_000 },
    { path: '/Users/demo/Churn/cohorts.ipynb', name: 'cohorts', folder: 'Churn', openedAt: Date.now() - 3 * 3600_000 },
  ]
  api.listVariables = async () => [
    { name: 'orders', type: 'DataFrame', shape: '2,863 × 7', detail: 'id, created_at, customer_id, region, plan, total, returned' },
    { name: 'monthly', type: 'DataFrame', shape: '4 × 2', detail: 'orders, revenue' },
  ]
  let settings = fakeSettings()
  if (mode === 'setup') settings = { ...settings, onboarded: false, keySource: null, hasKey: { gateway: false, anthropic: false } }
  api.getSettings = async () => settings
  api.updateSettings = async ({ apiKey, ...rest }) => {
    settings = { ...settings, ...rest }
    if (apiKey) settings.hasKey = { ...settings.hasKey, [apiKey.provider]: apiKey.key.trim() !== '' }
    settings.keySource = settings.hasKey[settings.provider] ? 'settings' : null
    return settings
  }
  // A first launch finds no Python; setting one up streams a few lines and succeeds
  let python: PythonState = mode === 'setup' ? { python: null, version: null, source: null, managedEnvExists: false, missingPackages: [] } : { python: '/usr/bin/python3', version: '3.12.4', source: 'system', managedEnvExists: false, missingPackages: [] }
  const pythonLogs = new Set<(line: string) => void>()
  api.pythonState = async () => python
  api.onPythonLog = (l) => {
    pythonLogs.add(l)
    return () => pythonLogs.delete(l)
  }
  api.setupPython = async () => {
    for (const line of ['Creating a virtual environment…', 'Installing pandas', 'Installing numpy', 'Installing matplotlib', 'Done.']) {
      pythonLogs.forEach((l) => l(line))
      await wait(450)
    }
    python = { python: '~/Library/Application Support/Ilios/python/bin/python', version: '3.12.4', source: 'managed', managedEnvExists: true, missingPackages: [] }
    return python
  }
  if (mode === 'setup') api.recentNotebooks = async () => []
  // A spread of makers like the gateway's, one of them without a logo
  api.listModels = async () => ({
    provider: 'gateway',
    error: null,
    models: [
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', maker: 'Anthropic', price: '$5 / $25' },
      { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', maker: 'Anthropic', price: '$3 / $15' },
      { id: 'openai/gpt-6', name: 'GPT-6', maker: 'OpenAI', price: '$2.50 / $15' },
      { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', maker: 'OpenAI', price: '$0.20 / $1.20' },
      { id: 'google/gemini-3-pro', name: 'Gemini 3 Pro', maker: 'Google', price: '$2 / $12' },
      { id: 'spacexai/grok-4.20-non-reasoning', name: 'Grok 4.20', maker: 'xAI', price: '$3 / $15' },
      { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4', maker: 'DeepSeek', price: '$0.28 / $0.42' },
      { id: 'mistral/mistral-large-3', name: 'Mistral Large 3', maker: 'Mistral', price: '$0.50 / $1.50' },
      { id: 'moonshotai/kimi-k3', name: 'Kimi K3', maker: 'Moonshot AI', price: '$0.60 / $2.50' },
      { id: 'zai/glm-5', name: 'GLM 5', maker: 'Z.ai', price: '$0.60 / $2.20' },
      { id: 'thinkingmachines/inkling', name: 'Inkling', maker: 'Thinking Machines', price: '$1 / $4' },
    ],
  })
  setApi(api)
  actions.load(sampleNotebook(), '/Users/demo/Summer sales/review.ipynb')
  useNotebook.setState({ kernel: { status: 'idle', python: '3.12.4', cwd: '/Users/demo/Summer sales', error: null } })
  const cells = useNotebook.getState().notebook.cells
  useNotebook.setState({ selectedId: cells[2].id, lastFinishedId: cells[2].id })
  // A little history for the run log
  const log = [
    { kind: 'wrote' as const, text: 'Wrote “Revenue and orders by month”', cellId: cells[2].id, at: Date.now() - 4 * 60_000 },
    { kind: 'failed' as const, text: '“Revenue and orders by month” failed: KeyError', cellId: cells[2].id, at: Date.now() - 6 * 60_000 },
    { kind: 'ran' as const, text: 'Ran “Load orders.csv”', cellId: cells[1].id, at: Date.now() - 12 * 60_000 },
    { kind: 'restarted' as const, text: 'Restarted Python', at: Date.now() - 14 * 60_000 },
    { kind: 'wrote' as const, text: 'Wrote “Load orders.csv”', cellId: cells[1].id, at: Date.now() - 30 * 60_000 },
  ]
  useNotebook.setState({ log: log.map((e, i) => ({ ...e, id: -i - 1 })) })
  void actions.refreshVariables()
  if (mode !== 'notebook') {
    useNotebook.setState({ settings, python })
    actions.showWelcome(false)
  }
}
