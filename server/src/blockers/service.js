import { Blocker } from '../models/blocker.js'
import { recordAudit, userActor, diffChanges } from '../audit/audit.js'
import { notFound, forbidden, badRequest, conflict } from '../http/errors.js'
import { salIdForBuilding } from '../hierarchy/lookup.js'
import { notifyQuietly, paths } from '../notifications/notify.js'

const blockerLink = (organisationId, projectId, b) => (b.buildingId ? paths.building(organisationId, projectId, String(b.buildingId)) : null)

const optionalId = (v) => (v ? String(v) : null)

export const toBlocker = (b) => ({
  id: String(b._id),
  buildingId: optionalId(b.buildingId),
  salId: optionalId(b.salId),
  phaseKey: b.phaseKey,
  description: b.description,
  relatedObjectType: b.relatedObjectType ?? null,
  relatedObjectId: optionalId(b.relatedObjectId),
  source: b.source ?? 'user',
  raisedAt: b.raisedAt,
  raisedBy: String(b.raisedBy),
  ownerId: optionalId(b.ownerId),
  priority: b.priority,
  status: b.status,
  resolvedAt: b.resolvedAt ?? null,
  resolvedBy: optionalId(b.resolvedBy),
})

// A building's blockers plus the SAL-level ones that hold it up (Unassigned
// CMO devices sit at SAL level until a PM assigns them; brief v2.3 §5.1).
export async function blockersForBuilding(buildingId) {
  const salId = await salIdForBuilding(buildingId)
  const filter = salId ? { $or: [{ buildingId }, { buildingId: null, salId }] } : { buildingId }
  return Blocker.find(filter).sort({ raisedAt: -1 }).lean()
}

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
      // PMs, and the owner when one is named.
      await notifyQuietly({ type: 'blocker_raised', projectId, buildingId: body.buildingId, title: `Blocker raised: ${blocker.description.slice(0, 120)}`, body: `Priority ${blocker.priority}`, relatedObjectType: 'blocker', relatedObjectId: blocker._id, link: blockerLink(organisationId, projectId, blocker), actorId: actor.userId, to: { roles: ['pm'], userIds: blocker.ownerId ? [blocker.ownerId] : [] } })
      return toBlocker(blocker)
    },

    // `scope` (access/scope.js) hides SAL-level blockers outside the caller's scope.
    async listForBuilding({ buildingId, scope = null }) {
      return (await blockersForBuilding(buildingId)).filter((b) => !scope || scope.coversItem(b)).map(toBlocker)
    },

    // Transitions follow DATA-MODEL §5.10: open/in_progress -> resolved and
    // open -> in_progress need the owner or a PM; resolved -> open (reopen)
    // is open to any project member. Reassigning the owner is PM only.
    async update({ organisationId, projectId, actor, actorRoles, id, body, scope = null }) {
      const blocker = await Blocker.findById(id)
      if (!blocker || (scope && !scope.coversItem(blocker))) throw notFound('Blocker not found')
      const isPm = actorRoles.includes('pm')
      const isOwner = blocker.ownerId && String(blocker.ownerId) === String(actor.userId)
      const before = { status: blocker.status, ownerId: blocker.ownerId }

      if (body.ownerId !== undefined) {
        if (!isPm) throw forbidden('Only a PM may assign a blocker')
        blocker.ownerId = body.ownerId
      }
      if (body.status !== undefined) {
        if (blocker.source === 'system') {
          throw conflict('system_blocker', 'This blocker clears automatically — assign the device to a building to resolve it')
        }
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
      const common = { projectId, buildingId: blocker.buildingId, relatedObjectType: 'blocker', relatedObjectId: blocker._id, link: blockerLink(organisationId, projectId, blocker), actorId: actor.userId }
      if (blocker.ownerId && String(blocker.ownerId) !== String(before.ownerId ?? '')) await notifyQuietly({ ...common, type: 'blocker_assigned', title: `Blocker assigned to you: ${blocker.description.slice(0, 120)}`, to: { userIds: [blocker.ownerId] } })
      if (before.status !== 'resolved' && blocker.status === 'resolved') await notifyQuietly({ ...common, type: 'blocker_resolved', title: `Blocker resolved: ${blocker.description.slice(0, 120)}`, to: { userIds: [blocker.raisedBy] } })
      return toBlocker(blocker)
    },
  }
}
