import { getFunctionName } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { cloudApi } from '@dalliance/shared/cloud-api'
import { metricsApi } from '@dalliance/shared/metrics'
import { api, internal } from './convex/_generated/api'

// contract.ts checks the shapes. Function names are plain strings, so this checks them
describe('the functions the app calls', () => {
  it('exist under the names the app uses', () => {
    expect(getFunctionName(cloudApi.plans)).toBe(getFunctionName(api.billing.plans))
    expect(getFunctionName(cloudApi.status)).toBe(getFunctionName(api.billing.status))
    expect(getFunctionName(cloudApi.checkout)).toBe(getFunctionName(api.billing.checkout))
    expect(getFunctionName(cloudApi.portal)).toBe(getFunctionName(api.billing.portal))
    expect(getFunctionName(cloudApi.credits)).toBe(getFunctionName(api.usage.credits))
  })
})

describe('the functions the admin app calls', () => {
  it('exist under the names the admin app uses', () => {
    expect(getFunctionName(metricsApi.overview)).toBe(getFunctionName(internal.metrics.overview))
  })
})
