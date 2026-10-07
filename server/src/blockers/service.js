import { Blocker } from '../models/blocker.js'
import { recordAudit, userActor, diffChanges } from '../audit/audit.js'
import { notFound, forbidden, badRequest } from '../http/errors.js'

const toBlocker = (b) => ({
  id: String(b._id),
  buildingId: String(b.buildingId),
  phaseKey: b.phaseKey,
  description: b.description,
  relatedObjectType: b.relatedObjectType ?? null,
  relatedObjectId: b.relatedObjectId ? String(b.relatedObjectId) : null,
  raisedAt: b.raisedAt,
  raisedBy: String(b.raisedBy),
  ownerId: b.ownerId ? String(b.ownerId) : null,
  priority: b.priority,
  status: b.status,
  resolvedAt: b.resolvedAt ?? null,
  resolvedBy: b.resolvedBy ? String(b.resolvedBy) : null,
})

export function createBlockersService() {
  return {
    // Raising is open to any project role (ACTIONS.RAISE_BLOCKER checks that
    // at the route). This is only the human-raised kind (DATA-MODEL §5.10);
    // calculated blockers arrive with the modules that calculate them.
    async raise({ organisationId, projectId, actor, body }) {
      const blocker = await Blocker.create({
        buildingId: body.buildingId,
        phaseKey: body.phaseKey,
        description: body.description,
        relatedObjectType: body.relatedObjectType ?? null,
        relatedObjectId: body.relatedObjectId ?? null,
        ownerId: body.ownerId ?? null,
        priority: body.priority,
        raisedBy: actor.userId,
      })
      await recordAudit({
        organisationId,
        projectId,
        buildingId: body.buildingId,
        phaseKey: body.phaseKey,
        actor: userActor(actor.userId, actor.role),
        action: 'blocker.raised',
        objectType: 'Blocker',
        objectId: blocker._id,
        changeType: 'design_intent',
        source: 'ui',
      })
      return toBlocker(blocker)
    },

    async listForBuilding({ buildingId }) {
      const rows = await Blocker.find({ buildingId }).sort({ raisedAt: -1 }).lean()
      return rows.map(toBlocker)
    },

    // Transitions follow DATA-MODEL §5.10: open/in_progress -> resolved and
    // open -> in_progress need the owner or a PM; resolved -> open (reopen)
    // is open to any project member. Reassigning the owner is PM only.
    async update({ organisationId, projectId, actor, actorRoles, id, body }) {
      const blocker = await Blocker.findById(id)
      if (!blocker) throw notFound('Blocker not found')
      const isPm = actorRoles.includes('pm')
      const isOwner = blocker.ownerId && String(blocker.ownerId) === String(actor.userId)
      const before = { status: blocker.status, ownerId: blocker.ownerId }

      if (body.ownerId !== undefined) {
        if (!isPm) throw forbidden('Only a PM may assign a blocker')
        blocker.ownerId = body.ownerId
      }
      if (body.status !== undefined) {
        if (body.status === 'resolved' || (blocker.status === 'open' && body.status === 'in_progress')) {
          if (!isPm && !isOwner) throw forbidden('Only the owner or a PM may do that')
        } else if (blocker.status === 'resolved' && body.status === 'open') {
          // any project member may reopen
        } else {
          throw badRequest(`Cannot move a blocker from ${blocker.status} to ${body.status}`)
        }
        blocker.status = body.status
        blocker.resolvedAt = body.status === 'resolved' ? new Date() : null
        blocker.resolvedBy = body.status === 'resolved' ? actor.userId : null
      }
      await blocker.save()

      const changes = diffChanges({ objectType: 'Blocker', objectId: blocker._id, before, after: { status: blocker.status, ownerId: blocker.ownerId }, fields: ['status', 'ownerId'] })
      if (changes.length) {
        await recordAudit({
          organisationId,
          projectId,
          buildingId: blocker.buildingId,
          phaseKey: blocker.phaseKey,
          actor: userActor(actor.userId, actor.role),
          action: 'blocker.updated',
          objectType: 'Blocker',
          objectId: blocker._id,
          changeType: 'design_intent',
          source: 'ui',
          changes,
        })
      }
      return toBlocker(blocker)
    },
  }
}
