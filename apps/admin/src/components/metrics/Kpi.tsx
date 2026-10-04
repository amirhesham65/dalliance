import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

/** One headline number with a line of context under it. */
export function Kpi({ label, value, detail }: { label: string; value: string; detail?: React.ReactNode }) {
  return (
    <Card size="sm" className="gap-1">
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      </CardHeader>
      {detail ? <CardContent className="text-xs text-muted-foreground">{detail}</CardContent> : null}
    </Card>
  )
}
