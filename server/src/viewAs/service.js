import { ViewAsSession } from '../models/viewAsSession.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { notFound } from '../http/errors.js'

// DATA-MODEL §1.6. View As is Org Admin only (checked by ACTIONS.VIEW_AS at
// the route) and view-only (enforced by applyViewAs, http/middleware.js).
// The actor's own role, not the viewed role, is what gets audited here.
export function createViewAsService() {
  return {
    async start({ organisationId, projectId, actor }, { role }) {
      const session = await ViewAsSession.create({ organisationId, projectId, actorUserId: actor.userId, viewedRole: role })
      await recordAudit({
        organisationId,
        projectId,
        actor: userActor(actor.userId, actor.role),
        action: 'view_as.started',
        objectType: 'ViewAsSession',
        objectId: session._id,
        changeType: 'view_as_access',
        source: 'ui',
        viewAsSessionId: session._id,
        comment: `Viewing as ${role}`,
      })
      return { id: String(session._id), viewedRole: session.viewedRole, startedAt: session.startedAt }
    },

    async end({ organisationId, projectId, actor }, { sessionId }) {
      const session = await ViewAsSession.findOne({ _id: sessionId, actorUserId: actor.userId, endedAt: null })
      if (!session) throw notFound('View As session not found or already ended')
      session.endedAt = new Date()
      await session.save()
      await recordAudit({
        organisationId,
        projectId,
        actor: userActor(actor.userId, actor.role),
        action: 'view_as.ended',
        objectType: 'ViewAsSession',
        objectId: session._id,
        changeType: 'view_as_access',
        source: 'ui',
        viewAsSessionId: session._id,
      })
      return { id: String(session._id), ended: true }
    },
  }
}
