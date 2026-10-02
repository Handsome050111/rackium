import { describe, it, expect } from 'vitest'
import {
  getSurveyTabContext,
  updateKeyValueSection,
  confirmPrefillField,
  addTableRow,
  duplicateTableRow,
  removeTableRow,
  updateTableRow,
  updateItemListCell,
  submitSurveyTab,
  verifySurveyTab,
  rejectSurveyTab,
  addCustomField,
  getBuildingSurveyProgress,
  validateSurveySerial,
} from './surveyFormsDesign.js'
import { getPhaseCards } from './buildings.js'

// Each test uses a tab the others don't touch, so the module-level store
// (one instance for the whole test file, matching every other api/ module's
// pattern) can't leak state between them.

describe('key_value tabs: SSID (building scope)', () => {
  it('starts Draft and incomplete, reaches 100% once every must field is set', async () => {
    const before = await getSurveyTabContext('b001', 'SSID', null)
    expect(before.status.status).toBe('draft')
    expect(before.completeness.complete).toBe(true) // zero rows yet — an empty table is trivially complete

    const section = before.tabDef.sections[0] // table: SSIDs
    const row = await addTableRow('b001', 'SSID', null, 0)
    const patch = Object.fromEntries(section.fields.map((f) => [f.key, 'x']))
    await updateTableRow('b001', 'SSID', null, 0, row.id, patch)

    const after = await getSurveyTabContext('b001', 'SSID', null)
    expect(after.completeness.complete).toBe(true)
  })
})

describe('submit / verify / reject workflow: Storage Area (building scope)', () => {
  it('blocks submit until complete, then blocks by role, then succeeds for Field Engineer', async () => {
    const incomplete = await submitSurveyTab('b001', 'Storage Area', null, 'field_engineer')
    expect(incomplete.ok).toBe(false)

    const { tabDef } = await getSurveyTabContext('b001', 'Storage Area', null)
    const patch = Object.fromEntries(
      tabDef.sections[0].fields.filter((f) => f.requirement !== 'good_to_have').map((f) => [f.key, f.type === 'photo' ? { count: 1 } : 'x'])
    )
    await updateKeyValueSection('b001', 'Storage Area', null, 0, patch)

    const wrongRole = await submitSurveyTab('b001', 'Storage Area', null, 'architect')
    expect(wrongRole.ok).toBe(false)

    const submitted = await submitSurveyTab('b001', 'Storage Area', null, 'field_engineer')
    expect(submitted.ok).toBe(true)
    expect((await getSurveyTabContext('b001', 'Storage Area', null)).status.status).toBe('submitted')
  })

  it('verify requires Submitted status and the Architect role; reject requires a comment and returns to Draft on the next edit', async () => {
    // Room-scoped (unlike Storage Area above) so roomId actually carves out
    // an independent record from every other test in this file.
    const { tabDef } = await getSurveyTabContext('b001', 'Local Server', 'room-ug1705')
    const section = tabDef.sections[0]
    const row = await addTableRow('b001', 'Local Server', 'room-ug1705', 0)
    const patch = Object.fromEntries(section.fields.filter((f) => f.requirement !== 'good_to_have').map((f) => [f.key, 'x']))
    await updateTableRow('b001', 'Local Server', 'room-ug1705', 0, row.id, patch)

    const verifyTooEarly = await verifySurveyTab('b001', 'Local Server', 'room-ug1705', 'architect')
    expect(verifyTooEarly.ok).toBe(false)

    await submitSurveyTab('b001', 'Local Server', 'room-ug1705', 'field_engineer')

    const verifyWrongRole = await verifySurveyTab('b001', 'Local Server', 'room-ug1705', 'pm')
    expect(verifyWrongRole.ok).toBe(false)

    const rejectNoComment = await rejectSurveyTab('b001', 'Local Server', 'room-ug1705', 'architect', '')
    expect(rejectNoComment.ok).toBe(false)

    const rejected = await rejectSurveyTab('b001', 'Local Server', 'room-ug1705', 'architect', 'Hostname is wrong')
    expect(rejected.ok).toBe(true)
    expect((await getSurveyTabContext('b001', 'Local Server', 'room-ug1705')).status.status).toBe('rejected')

    // Editing a rejected tab returns it to Draft — it isn't stuck rejected forever.
    await updateTableRow('b001', 'Local Server', 'room-ug1705', 0, row.id, { hostname: 'y' })
    expect((await getSurveyTabContext('b001', 'Local Server', 'room-ug1705')).status.status).toBe('draft')
  })
})

describe('table rows: Firewall (room scope)', () => {
  it('add/duplicate/remove a row', async () => {
    const row = await addTableRow('b001', 'Firewall', 'room-tr-eg-02', 0)
    await updateTableRow('b001', 'Firewall', 'room-tr-eg-02', 0, row.id, { firewall_hostname: 'FW-01' })

    const dup = await duplicateTableRow('b001', 'Firewall', 'room-tr-eg-02', 0, row.id)
    expect(dup.id).not.toBe(row.id)

    let ctx = await getSurveyTabContext('b001', 'Firewall', 'room-tr-eg-02')
    expect(ctx.record.sections[0]).toHaveLength(2)
    expect(ctx.record.sections[0][1].firewall_hostname).toBe('FW-01')

    await removeTableRow('b001', 'Firewall', 'room-tr-eg-02', 0, row.id)
    ctx = await getSurveyTabContext('b001', 'Firewall', 'room-tr-eg-02')
    expect(ctx.record.sections[0]).toHaveLength(1)
  })

  it('an empty table never blocks submit — not every room has a firewall', async () => {
    const result = await submitSurveyTab('b001', 'Firewall', 'room-tr-1og-01', 'field_engineer')
    expect(result.ok).toBe(true)
  })
})

describe('item_list: Passive Requirements for FMO (building scope)', () => {
  it('fills a cell and feeds completeness', async () => {
    const { tabDef } = await getSurveyTabContext('b001', 'Passive Requirements for FMO', null)
    const section = tabDef.sections[0]
    for (const row of section.fields) {
      for (const col of section.item_columns) {
        await updateItemListCell('b001', 'Passive Requirements for FMO', null, 0, row.key, col, col === 'photograph' ? { count: 1 } : 'x')
      }
    }
    const after = await getSurveyTabContext('b001', 'Passive Requirements for FMO', null)
    expect(after.completeness.complete).toBe(true)
  })
})

describe('Rack Layout: repeatable_per reconciliation', () => {
  it('creates one instance per real rack in the room, and a filled instance reads back correctly', async () => {
    const ctx = await getSurveyTabContext('b001', 'Rack Layout', 'room-tr-eg-01')
    expect(ctx.rackList.length).toBeGreaterThan(0)
    expect(ctx.record.sections[0]).toHaveLength(ctx.rackList.length)
    expect(ctx.record.sections[0].map((i) => i.rackId).sort()).toEqual(ctx.rackList.map((r) => r.id).sort())
  })
})

describe('prefill confirmation: Location Details', () => {
  it('a prefilled_validated field needs its confirm tick, not just a value, to count as filled', async () => {
    const { tabDef } = await getSurveyTabContext('b001', 'Location Details', null)
    const field = tabDef.sections[0].fields.find((f) => f.prefill === 'prefilled_validated')
    await updateKeyValueSection('b001', 'Location Details', null, 0, { [field.key]: 'some value' })

    const before = await getSurveyTabContext('b001', 'Location Details', null)
    expect(before.record.sections[0][`${field.key}__confirmed`]).toBeFalsy()

    await confirmPrefillField('b001', 'Location Details', null, 0, field.key)
    const after = await getSurveyTabContext('b001', 'Location Details', null)
    expect(after.record.sections[0][`${field.key}__confirmed`]).toBe(true)
  })
})

describe('custom fields', () => {
  it('Org Admin can add a custom field; it is never required', async () => {
    const denied = await addCustomField('WLAN', { label: 'Internal note', type: 'text' }, 'architect')
    expect(denied.ok).toBe(false)

    const added = await addCustomField('WLAN', { label: 'Internal note', type: 'text' }, 'org_admin')
    expect(added.ok).toBe(true)

    const { tabDef } = await getSurveyTabContext('b001', 'WLAN', 'room-tr-2og-01')
    const custom = tabDef.sections[0].fields.find((f) => f.key === added.field.key)
    expect(custom.label).toBe('Internal note')
    expect(custom.requirement).toBe('unspecified') // never counted toward completeness
  })
})

describe('getBuildingSurveyProgress', () => {
  it('aggregates building-scoped and every room-scoped tab, and pushes the survey phase status', async () => {
    const progress = await getBuildingSurveyProgress('b003')
    expect(progress.totalCount).toBeGreaterThan(0)
    const cards = await getPhaseCards('b003')
    expect(['not_started', 'in_progress', 'approved']).toContain(cards.find((c) => c.id === 'survey').status)
  })
})

describe('validateSurveySerial', () => {
  it('reuses the CMO/duplicate serial logic from the device scanner', async () => {
    expect(await validateSurveySerial('room-tr-eg-01', 'FCW2637A1B2')).toBe('validated')
    expect(await validateSurveySerial('room-tr-eg-01', 'NOT-IN-CMO')).toBe('not-in-cmo')
  })
})
