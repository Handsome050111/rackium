import { recordingRouter } from '../http/routeRecorder.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, applyViewAs } from '../http/middleware.js'

// M7a-2 (brief v2.2 §20.9.3, §20.9.6): DGUV compliance dashboards — the
// CMDB's readers (every project member), buildings in scope only.
export function dguvRoutes({ config, dguv }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]
  r.get('/', ...base, validate({ query: C.dguvQuery }), async (req, res) => {
    res.json(await dguv.view(req, req.input.query))
  })
  r.get('/devices', ...base, validate({ query: C.dguvQuery }), async (req, res) => {
    res.json(await dguv.devices(req, req.input.query))
  })
  r.get('/export.csv', ...base, validate({ query: C.dguvQuery }), async (req, res) => {
    const csv = await dguv.csv(req, req.input.query)
    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="dguv-${req.input.query.level}.csv"`)
    res.send(csv)
  })
  return r
}
