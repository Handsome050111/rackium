import { Router } from 'express'
import { healthResponse } from '@rackium/shared/contracts.js'
import { databaseIsUp } from '../db/connect.js'
import { authRoutes } from './auth.js'
import { organisationRoutes } from './organisations.js'

export const API_VERSION = '1'

export function apiRouter({ config, auth, org, rateLimits, openapiDocument, version }) {
  const r = Router()

  r.get('/health', (req, res) => {
    const database = databaseIsUp() ? 'up' : 'down'
    const body = healthResponse.parse({ status: database === 'up' ? 'ok' : 'degraded', database, version })
    res.status(database === 'up' ? 200 : 503).json(body)
  })

  r.get('/openapi.json', (req, res) => {
    res.json(openapiDocument())
  })

  r.use('/auth', authRoutes({ config, auth, rateLimits }))
  r.use('/orgs/:orgId', organisationRoutes({ config, org, rateLimits }))

  return r
}
