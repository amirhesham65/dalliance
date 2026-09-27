/**
 * A pretend desktop bridge for looking at the UI in a plain browser: open the renderer with ?demo.
 * Nothing here runs inside Electron, where window.ilios is the real bridge.
 */
import { fakeApi, result } from '@/test/fake-api'
import type { RunEvent } from '@ilios/shared/ipc'
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
  return {
    cells: [
      newNoteCell('# Summer sales review\nHow did orders and revenue move from May to August, and what drove the August jump?'),
      load,
      monthly,
      region,
      newPromptCell('Which customers ordered more than 5 times, and what did they buy most?'),
    ],
  }
}

export function installDemo() {
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
  api.updateSettings = async (u) => ({ ...(await api.getSettings()), ...u }) as Awaited<ReturnType<typeof api.getSettings>>
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
}
