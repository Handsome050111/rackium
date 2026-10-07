import { computeOverallProgress } from '@rackium/shared/phaseCalculations.js'
import { Building } from '../models/building.js'
import { PhaseStatus } from '../models/phaseStatus.js'
import { Blocker } from '../models/blocker.js'
import { AuditEntry } from '../models/auditEntry.js'
import { notFound } from '../http/errors.js'

const RECENT_ACTIVITY_LIMIT = 20
const HIDDEN_FROM_NON_ADMIN = new Set(['view_as_access', 'platform_access'])

// The real per-building dashboard (client audit 1.1-1.3). Devices and
// connections are 0 until the modules that create them (M3+); everything
// else here is already real: phase status, blockers, and the audit trail.
export function createDashboardService() {
  return {
    async getBuildingDashboard({ buildingId, activePhases, isOrgAdmin }) {
      const building = await Building.findById(buildingId).lean()
      if (!building) throw notFound('Building not found')

      const statusRows = await PhaseStatus.find({ buildingId }).lean()
      const statusByPhase = new Map(statusRows.map((r) => [r.phaseKey, r]))
      const phases = activePhases.map(({ phaseKey, position }) => {
        const row = statusByPhase.get(phaseKey)
        return { phaseKey, position, status: row?.status ?? 'not_started', subLabel: row?.subLabel ?? null }
      })
      const completionPercent = computeOverallProgress(phases)

      const blockers = await Blocker.find({ buildingId }).sort({ raisedAt: -1 }).lean()
      const openBlockers = blockers.filter((b) => b.status !== 'resolved')

      const auditFilter = { buildingId }
      if (!isOrgAdmin) auditFilter.changeType = { $nin: [...HIDDEN_FROM_NON_ADMIN] }
      const recentActivity = await AuditEntry.find(auditFilter).sort({ occurredAt: -1 }).limit(RECENT_ACTIVITY_LIMIT).lean()

      return {
        building: { id: String(building._id), code: building.code, name: building.name },
        phases,
        kpis: {
          devices: 0,
          connections: 0,
          openIssues: openBlockers.length,
          completionPercent,
        },
        blockers: blockers.map((b) => ({
          id: String(b._id),
          description: b.description,
          phaseKey: b.phaseKey,
          priority: b.priority,
          status: b.status,
          ownerId: b.ownerId ? String(b.ownerId) : null,
          raisedAt: b.raisedAt,
        })),
        recentActivity: recentActivity.map((e) => ({
          id: String(e._id),
          occurredAt: e.occurredAt,
          action: e.action,
          objectType: e.objectType,
          objectId: e.objectId,
          actor: { type: e.actor.type, userId: e.actor.userId ? String(e.actor.userId) : null, role: e.actor.role ?? null },
          comment: e.comment ?? null,
        })),
      }
    },
  }
}
