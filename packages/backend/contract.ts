import type { FunctionReference } from 'convex/server'
import type { cloudApi } from '@dalliance/shared/cloud-api'
import type { api } from './convex/_generated/api'

// The desktop app calls these functions through cloudApi in packages/shared. Each line fails to typecheck when the
// backend's function is renamed, takes other arguments, or returns something the app doesn't expect.

type Matches<App, Backend> =
  App extends FunctionReference<infer Type, 'public', infer Args, infer Returns>
    ? Backend extends FunctionReference<Type, 'public', Args, Returns>
      ? true
      : false
    : false

export type Contract = [
  Matches<typeof cloudApi.plans, typeof api.billing.plans>,
  Matches<typeof cloudApi.status, typeof api.billing.status>,
  Matches<typeof cloudApi.checkout, typeof api.billing.checkout>,
  Matches<typeof cloudApi.portal, typeof api.billing.portal>,
  Matches<typeof cloudApi.credits, typeof api.usage.credits>,
]

export const contract: Contract = [true, true, true, true, true]
