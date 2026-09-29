import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'

const http = httpRouter()

// Serves Better Auth under /api/auth on the deployment's .convex.site URL. The website proxies to it.
authComponent.registerRoutes(http, createAuth)

export default http
