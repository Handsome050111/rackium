import { describe, it, expect } from 'vitest'
import { can, ACTIONS, canSeePrices, canSeeProcurementDetails, rolesAllowed, PROJECT_ROLES, ROLE_LABELS, canApproveSubmission } from './policy.js'
import { requestProblem } from './documents/types.js'
import { dguvObligation, acceptanceBlockers } from './deployment.js'
import { summarise, stateOf } from './dguvRollup.js'
import { catalogueRowToItem, CATALOGUE_CSV_COLUMNS } from './catalogue.js'

// M7b-1 (addendum v2.3 Q11, Q13): the External Reviewer and DGUV exemption.
describe('External Reviewer', () => {
  const er = ['external_reviewer']
  it('is a project role with its own label; approves designs where a Reviewer does (never their own submission)', () => {
    expect(PROJECT_ROLES).toContain('external_reviewer')
    expect(ROLE_LABELS.external_reviewer).toBe('External Reviewer')
    expect(can(er, ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)).toBe(true)
    expect(canApproveSubmission({ roles: er, actorId: 'a', submitterId: 'b' })).toBe(true)
    expect(canApproveSubmission({ roles: er, actorId: 'a', submitterId: 'a' })).toBe(false)
    expect(can(er, ACTIONS.RAISE_BLOCKER)).toBe(true)
    expect(can(er, ACTIONS.DOWNLOAD_PORT_CABLE_SCHEDULES)).toBe(true)
    expect(rolesAllowed(ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)).toEqual(['pm', 'reviewer', 'external_reviewer'])
  })
  it('sees no prices, margins, suppliers or cost documents, accepts no installation, reads no audit log', () => {
    expect(canSeePrices(er)).toBe(false)
    expect(canSeePrices(er, { architectsSeePrices: true })).toBe(false)
    expect(canSeeProcurementDetails(er)).toBe(false)
    expect(canSeeProcurementDetails(['reviewer'])).toBe(true)
    expect(canSeeProcurementDetails(['org_admin', 'external_reviewer'])).toBe(true)
    for (const a of [ACTIONS.SEE_PRICES_MARGINS, ACTIONS.MARK_INSTALLATION_ACCEPTED, ACTIONS.VIEW_AUDIT_LOG, ACTIONS.APPROVE_BOM_UPDATE_PROCUREMENT, ACTIONS.VIEW_PERSON_METRICS, ACTIONS.MANAGE_DGUV_EXEMPTIONS]) expect(can(er, a), a).toBe(false)
    expect(requestProblem({ typeKey: 'bom-final', format: 'xlsx', options: { prices: 'cost' }, roles: er })).toMatch(/cost prices/)
    expect(requestProblem({ typeKey: 'bom-final', format: 'xlsx', options: { prices: 'sell' }, roles: er, canSeePrices: false })).toMatch(/may see prices/)
    expect(requestProblem({ typeKey: 'bom-final', format: 'xlsx', roles: er })).toBeNull()
  })
})

describe('DGUV obligation and exemption', () => {
  const mains = { powerInletType: 'C14' }
  it('the model decides by default (its dguvRequired, else mains power); a device override wins', () => {
    expect(dguvObligation(mains)).toMatchObject({ byType: true, required: true, exempt: false, overridden: false })
    expect(dguvObligation({})).toMatchObject({ byType: false, required: false, exempt: false })
    expect(dguvObligation({ ...mains, dguvRequired: false })).toMatchObject({ byType: false, required: false })
    expect(dguvObligation({ dguvRequired: true })).toMatchObject({ byType: true, required: true })
    expect(dguvObligation(mains, { required: false, reason: 'UPS-fed' })).toMatchObject({ required: false, exempt: true, reason: 'UPS-fed', overridden: true })
    expect(dguvObligation({}, { required: true, reason: 'Client asked' })).toMatchObject({ required: true, exempt: false, reason: 'Client asked' })
    // An exempt device needs no inspection to be accepted.
    expect(acceptanceBlockers({ serialised: false, mainsPowered: dguvObligation(mains, { required: false, reason: 'x' }).required })).toEqual([])
  })
  it('exempt devices are counted apart, never the worst, and out of the compliant share', () => {
    const items = [{ inspected: true, status: 'valid' }, { inspected: false }, { exempt: true, inspected: false }]
    expect(stateOf(items[2])).toBe('exempt')
    expect(summarise(items)).toEqual({ counts: { total: 3, valid: 1, expiring_soon: 0, expiring: 0, overdue: 0, not_inspected: 1, exempt: 1 }, worst: 'not_inspected', compliantPct: 50 })
    expect(summarise([{ exempt: true }])).toMatchObject({ worst: 'exempt', compliantPct: null })
  })
  it('the catalogue CSV carries dguvRequired: blank = by power, yes / no = set for the model', () => {
    expect(CATALOGUE_CSV_COLUMNS).toContain('dguvRequired')
    const row = (v) => ({ kind: 'device_model', category: 'switch', vendor: 'Generic', model: 'X1', heightU: '1', dguvRequired: v })
    expect(catalogueRowToItem(row('')).item.dguvRequired).toBeNull()
    expect(catalogueRowToItem(row('yes')).item.dguvRequired).toBe(true)
    expect(catalogueRowToItem(row('no')).item.dguvRequired).toBe(false)
    expect(catalogueRowToItem(row('maybe')).errors.some((e) => e.field === 'dguvRequired')).toBe(true)
  })
})
