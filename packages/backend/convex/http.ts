import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'
import { polar } from './billing'
import { authorize, report } from './usage'

const http = httpRouter()

// Serves Better Auth under /api/auth on the deployment's .convex.site URL. The cloud site proxies to it.
authComponent.registerRoutes(http, createAuth)

// Polar's webhooks, straight to Convex. Each one is checked against POLAR_WEBHOOK_SECRET before it's stored
polar.registerRoutes(http, { path: '/polar/events' })

// The cloud site's model proxy: may this user make a call, and what did it cost. Both need AUTH_PROXY_SECRET
http.route({ path: '/gateway/authorize', method: 'POST', handler: authorize })
http.route({ path: '/gateway/report', method: 'POST', handler: report })

export default http
