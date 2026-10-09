import { computeOverallProgress } from '@rackium/shared/phaseCalculations.js'
import { Building } from '../models/building.js'
import { PhaseStatus } from '../models/phaseStatus.js'
import { Device } from '../models/device.js'
import { blockersForBuilding } from '../blockers/service.js'
import { cmoStatusByBuilding } from '../cmo/service.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { AuditEntry } from '../models/auditEntry.js'
import { notFound } from '../http/errors.js'

const RECENT_ACTIVITY_LIMIT = 20
const HIDDEN_FROM_NON_ADMIN = new Set(['view_as_access', 'platform_access'])

// The real per-building dashboard (client audit 1.1-1.3). Connections are 0
// until the module that creates them (M4+). The CMO phase is computed from
// the imported devices (M3a), never stored (DATA-MODEL §5.1).
export function createDashboardService() {
  return {
    // `scope` (access/scope.js): SAL-level blockers (Unassigned CMO devices)
    // are shown only to callers whose scope covers that SAL.
    async getBuildingDashboard({ buildingId, activePhases, isOrgAdmin, scope = null }) {
      const building = await Building.findById(buildingId).lean()
      if (!building) throw notFound('Building not found')

      const statusRows = await PhaseStatus.find({ buildingId }).lean()
      const statusByPhase = new Map(statusRows.map((r) => [r.phaseKey, r]))
      const cmoStatus = (await cmoStatusByBuilding()).get(String(building._id)) ?? 'not_started'
      const surveyStatus = (await surveyStatusByBuilding()).get(String(building._id)) ?? 'not_started'
      const phases = activePhases.map(({ phaseKey, position }) => {
        if (phaseKey === 'cmo') return { phaseKey, position, status: cmoStatus, subLabel: null }
        if (phaseKey === 'survey') return { phaseKey, position, status: surveyStatus, subLabel: null }
        const row = statusByPhase.get(phaseKey)
        return { phaseKey, position, status: row?.status ?? 'not_started', subLabel: row?.subLabel ?? null }
      })
      const completionPercent = computeOverallProgress(phases)

      const blockers = (await blockersForBuilding(buildingId)).filter((b) => !scope || scope.coversItem(b))
      const deviceCount = await Device.countDocuments({ buildingId })
      const openBlockers = blockers.filter((b) => b.status !== 'resolved')

      const auditFilter = { buildingId }
      if (!isOrgAdmin) auditFilter.changeType = { $nin: [...HIDDEN_FROM_NON_ADMIN] }
      const recentActivity = await AuditEntry.find(auditFilter).sort({ occurredAt: -1 }).limit(RECENT_ACTIVITY_LIMIT).lean()

      return {
        building: { id: String(building._id), code: building.code, name: building.name },
        phases,
        kpis: {
          devices: deviceCount,
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
          // SAL-level blockers (Unassigned CMO devices) have no building;
          // system ones clear themselves and are not resolved by hand.
          salId: b.salId ? String(b.salId) : null,
          buildingId: b.buildingId ? String(b.buildingId) : null,
          source: b.source ?? 'user',
          relatedObjectType: b.relatedObjectType ?? null,
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
