import { METRICS_RANGES, type Metrics, type MetricsRange } from '@dalliance/shared/metrics'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DailyChart } from '@/components/metrics/DailyChart'
import { Kpi } from '@/components/metrics/Kpi'
import { RangePicker } from '@/components/metrics/RangePicker'
import { deploymentName, readMetrics } from '@/lib/convex'
import { cost, money, number, percent } from '@/lib/format'

const toRange = (value: string | string[] | undefined): MetricsRange => METRICS_RANGES.find((d) => String(d) === value) ?? 30

export default async function MetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const days = toRange((await searchParams).days)
  const result = await readMetrics(days)
  const deployment = deploymentName()

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Metrics</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {deployment ? <Badge variant="outline" className="font-mono">{deployment}</Badge> : null}
            {result.ok ? <span>Updated {new Date(result.metrics.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> : null}
          </p>
        </div>
        <RangePicker days={days} />
      </header>
      {result.ok ? <Dashboard m={result.metrics} /> : <Problem result={result} />}
    </main>
  )
}

function Dashboard({ m }: { m: Metrics }) {
  // Revenue for the same stretch as the cost, so the two compare
  const rangeRevenue = (m.subscriptions.mrrUsd * m.days) / 30
  const range = `${m.days} days`
  const paid = m.subscriptions.paying - m.subscriptions.trialing
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Headline numbers">
        <Kpi label="Accounts" value={number(m.users.total)} detail={`+${number(m.users.new)} in ${range} · ${number(m.users.verified)} verified`} />
        <Kpi
          label="Paying plans"
          value={number(m.subscriptions.paying)}
          detail={
            <>
              {number(m.subscriptions.trialing)} trialing · {number(m.subscriptions.canceling)} canceling
              {m.subscriptions.pastDue ? <span className="text-warn"> · {number(m.subscriptions.pastDue)} past due</span> : null}
            </>
          }
        />
        <Kpi label="MRR" value={money(m.subscriptions.mrrUsd)} detail={paid ? `${money(m.subscriptions.mrrUsd / paid)} per paid plan` : 'No paid plans yet'} />
        <Kpi label="Active users" value={number(m.usage.activeUsers)} detail={`${number(m.usage.calls)} model calls in ${range}`} />
        <Kpi
          label="Model cost"
          value={cost(m.usage.costUsd)}
          detail={rangeRevenue > 0 ? `${percent(m.usage.costUsd / rangeRevenue)} of revenue for ${range}` : `In ${range}`}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <ChartCard title="Signups" description="New accounts per day, UTC">
          <DailyChart data={m.series} series="signups" color="var(--chart-1)" />
        </ChartCard>
        <ChartCard title="Active users" description="People who made a model call that day">
          <DailyChart data={m.series} series="activeUsers" color="var(--chart-3)" />
        </ChartCard>
        <ChartCard title="Model calls" description="Calls through the gateway per day">
          <DailyChart data={m.series} series="calls" color="var(--chart-4)" />
        </ChartCard>
        <ChartCard title="Model cost" description="The gateway's cost per day, in dollars">
          <DailyChart data={m.series} series="costUsd" color="var(--chart-2)" />
        </ChartCard>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>By cost over the last {range}</CardDescription>
        </CardHeader>
        <CardContent>
          {m.models.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Per call</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.models.map((model) => (
                  <TableRow key={model.model}>
                    <TableCell className="font-mono text-xs">{model.model}</TableCell>
                    <TableCell className="text-right tabular-nums">{number(model.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{cost(model.costUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{cost(model.costUsd / model.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.usage.costUsd ? percent(model.costUsd / m.usage.costUsd) : '–'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No model calls in the last {range}.</p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Problem({ result }: { result: { ok: false; missing: string[] } | { ok: false; error: string } }) {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{'missing' in result ? 'Not set up yet' : "Couldn't read the metrics"}</CardTitle>
        <CardDescription>
          {'missing' in result ? (
            <>
              Add {result.missing.map((name, i) => (
                <span key={name}>
                  {i ? ' and ' : ''}
                  <code className="font-mono text-foreground">{name}</code>
                </span>
              ))}{' '}
              to <code className="font-mono text-foreground">apps/admin/.env.local</code>, then restart the server. <code className="font-mono text-foreground">.env.example</code> says where each comes from.
            </>
          ) : (
            <>Check that the backend is deployed with <code className="font-mono text-foreground">metrics:overview</code> and that the deploy key belongs to this deployment.</>
          )}
        </CardDescription>
      </CardHeader>
      {'error' in result ? (
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{result.error}</pre>
        </CardContent>
      ) : null}
    </Card>
  )
}
