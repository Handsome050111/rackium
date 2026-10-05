import { describe, it, expect } from 'vitest'
import { ACTIONS, can, allowedActions, rolesForLevel, canApproveSubmission } from './policy.js'

describe('policy (v2.3 §4.3)', () => {
  it('only Org Admin manages users, settings and catalogue', () => {
    expect(can(['org_admin'], ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)).toBe(true)
    for (const role of ['pm', 'architect', 'reviewer', 'field_engineer', 'viewer']) {
      expect(can([role], ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)).toBe(false)
    }
  })

  it('Org Admin with no project role has no design approval rights', () => {
    expect(can(['org_admin'], ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)).toBe(false)
    expect(can(['org_admin'], ACTIONS.EDIT_SUBMIT_HLD_LLD)).toBe(false)
  })

  it('Org Admin gains design rights only through a project role', () => {
    expect(can(['org_admin', 'reviewer'], ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)).toBe(true)
  })

  it('Architect cannot approve HLD, LLD or Solution Package internally', () => {
    expect(can(['architect'], ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)).toBe(false)
    expect(can(['architect'], ACTIONS.EDIT_SUBMIT_HLD_LLD)).toBe(true)
  })

  it('share links and BOM approval are PM only', () => {
    expect(allowedActions(['pm'])).toContain(ACTIONS.GENERATE_CLIENT_SHARE_LINK)
    expect(allowedActions(['reviewer'])).not.toContain(ACTIONS.GENERATE_CLIENT_SHARE_LINK)
    expect(can(['architect'], ACTIONS.APPROVE_BOM_UPDATE_PROCUREMENT)).toBe(false)
  })

  it('Viewer can download schedules but not see prices or audit', () => {
    expect(can(['viewer'], ACTIONS.DOWNLOAD_PORT_CABLE_SCHEDULES)).toBe(true)
    expect(can(['viewer'], ACTIONS.SEE_PRICES_MARGINS)).toBe(false)
    expect(can(['viewer'], ACTIONS.VIEW_AUDIT_LOG)).toBe(false)
  })

  it('Field Engineer fills surveys, not verifies them', () => {
    expect(can(['field_engineer'], ACTIONS.FILL_SURVEY_UPLOAD_PHOTOS)).toBe(true)
    expect(can(['field_engineer'], ACTIONS.VERIFY_REJECT_SURVEY)).toBe(false)
  })

  it('CMDB operational edits by PM and Architect only', () => {
    expect(can(['pm'], ACTIONS.CMDB_OPERATIONAL_EDITS)).toBe(true)
    expect(can(['architect'], ACTIONS.CMDB_OPERATIONAL_EDITS)).toBe(true)
    expect(can(['reviewer'], ACTIONS.CMDB_OPERATIONAL_EDITS)).toBe(false)
  })

  it('no roles means no actions', () => {
    expect(allowedActions([])).toEqual([])
  })

  it('an unknown action throws instead of silently denying', () => {
    expect(() => can(['pm'], 'made_up_action')).toThrow(/Unknown policy action/)
  })

  it('organisation level is Org Admin only; project level has the five project roles', () => {
    expect(rolesForLevel('organisation')).toEqual(['org_admin'])
    expect(rolesForLevel('project')).toEqual(['pm', 'architect', 'reviewer', 'field_engineer', 'viewer'])
  })

  it("nobody approves their own submission; a reviewer may approve another person's", () => {
    expect(canApproveSubmission({ roles: ["reviewer"], actorId: "a", submitterId: "a" })).toBe(false)
    expect(canApproveSubmission({ roles: ["reviewer"], actorId: "a", submitterId: "b" })).toBe(true)
    expect(canApproveSubmission({ roles: ["pm"], actorId: "x", submitterId: "x" })).toBe(false)
    expect(canApproveSubmission({ roles: ["architect"], actorId: "a", submitterId: "b" })).toBe(false)
  })
})
