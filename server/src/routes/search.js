import { recordingRouter } from '../http/routeRecorder.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg } from '../http/middleware.js'

// M7a-2 (brief v2.3 §6.12): the top bar's global search over the caller's
// projects in the organisation (DATA-MODEL §5.16). A View-As session (header)
// limits it to that project and role.
export function searchRoutes({ config, search }) {
  const r = recordingRouter({ mergeParams: true })
  r.get('/search', requireUser(config), requireOrg(), validate({ query: C.searchQuery }), async (req, res) => {
    res.json(await search.search(req, req.input.query, { viewAsSessionId: req.get('x-view-as-session') ?? null }))
  })
  return r
}
