import { REFUSAL_TYPE } from '@dalliance/shared/cloud'

// What the desktop app needs to know about this service beyond its URL: where the Convex deployment is, for the
// plan's live queries. Asked once per launch, so moving the deployment never needs an app release.
const convexUrl = process.env.CONVEX_URL?.trim().replace(/\/$/, '') || null

export function GET() {
  if (!convexUrl) return Response.json({ error: { message: "Billing isn't set up on this deployment.", type: REFUSAL_TYPE } }, { status: 503 })
  return Response.json({ convexUrl }, { headers: { 'cache-control': 'public, max-age=300' } })
}
