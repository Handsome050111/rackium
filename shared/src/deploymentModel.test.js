import { describe, it, expect } from 'vitest'
import {
  deploymentLabel,
  isLiveConnection,
  isDeliveryReady,
  validateSerial,
  detectConnectionDeviations,
  detectRuDeviation,
  computeDeploymentKpis,
  computeDeploymentPhaseStatus,
  checklistProgress,
} from './deploymentModel.js'

describe('deploymentLabel — brief §4.4 mapping', () => {
  it('maps planned/ordered/delivered to Pending', () => {
    expect(deploymentLabel('planned')).toBe('Pending')
    expect(deploymentLabel('ordered')).toBe('Pending')
    expect(deploymentLabel('delivered')).toBe('Pending')
  })
  it('maps installed/configured to Installed', () => {
    expect(deploymentLabel('installed')).toBe('Installed')
    expect(deploymentLabel('configured')).toBe('Installed')
  })
  it('maps tested/accepted/in_service to Ready', () => {
    expect(deploymentLabel('tested')).toBe('Ready')
    expect(deploymentLabel('accepted')).toBe('Ready')
    expect(deploymentLabel('in_service')).toBe('Ready')
  })
})

describe('isLiveConnection', () => {
  it('is false for a merely designed connection', () => {
    expect(isLiveConnection('designed')).toBe(false)
    expect(isLiveConnection('approved')).toBe(false)
  })
  it('is true once installed or further along', () => {
    expect(isLiveConnection('installed')).toBe(true)
    expect(isLiveConnection('tested')).toBe(true)
  })
})

describe('isDeliveryReady — BOM line is tracked per role, not per device', () => {
  it('is ready only when that role\'s BOM line is Delivered', () => {
    const bomLinesByRole = { edge: { procurementStatus: 'Delivered' }, ap: { procurementStatus: 'Ordered' } }
    expect(isDeliveryReady({ role: 'edge' }, bomLinesByRole)).toBe(true)
    expect(isDeliveryReady({ role: 'ap' }, bomLinesByRole)).toBe(false)
  })
  it('is not ready when the role has no BOM line at all', () => {
    expect(isDeliveryReady({ role: 'edge' }, {})).toBe(false)
  })
})

describe('validateSerial', () => {
  const cmo = [{ serial: 'ABC123' }]
  const devices = [{ id: 'd1', installation: { serial: 'OTHER111' } }, { id: 'd2', installation: { serial: 'XYZ999' } }]

  it('validates a serial that matches CMO and is not used elsewhere', () => {
    expect(validateSerial('ABC123', 'room', 'd3', cmo, devices)).toBe('validated')
  })
  it('flags a serial not found in CMO', () => {
    expect(validateSerial('NEW000', 'room', 'd3', cmo, devices)).toBe('not_in_cmo')
  })
  it('flags a duplicate already recorded against a different device, even before checking CMO', () => {
    expect(validateSerial('XYZ999', 'room', 'd3', cmo, devices)).toBe('duplicate')
  })
  it('does not flag a device re-validating its own already-recorded serial', () => {
    expect(validateSerial('OTHER111', 'room', 'd1', cmo, devices)).toBe('not_in_cmo')
  })
})

describe('detectConnectionDeviations', () => {
  const connection = { media: 'os2', sourceSfp: 'SFP-10G-LR', destSfp: 'SFP-10G-LR', source: { port: 'Te1/1/4' }, dest: { port: 'Te1/1/1' }, cableId: '26184735' }

  it('flags a media/SFP deviation — the exact OM4-instead-of-OS2 scenario from the render', () => {
    const installed = { media: 'om4', sourceSfp: 'SFP-10G-SR', destSfp: 'SFP-10G-SR' }
    const deviations = detectConnectionDeviations(connection, installed)
    expect(deviations.map((d) => d.field)).toEqual(['media', 'sourceSfp', 'destSfp'])
    expect(deviations[0]).toEqual({ field: 'media', label: 'Media', designedValue: 'os2', installedValue: 'om4' })
  })

  it('reports no deviations when the installed values match the design exactly', () => {
    const installed = { media: 'os2', sourceSfp: 'SFP-10G-LR', destSfp: 'SFP-10G-LR', sourcePort: 'Te1/1/4', destPort: 'Te1/1/1', cableId: '26184735' }
    expect(detectConnectionDeviations(connection, installed)).toEqual([])
  })

  it('does not treat an unrecorded field as a deviation — it is "not yet recorded", not "matches"', () => {
    const installed = { media: 'os2' } // nothing else recorded yet
    expect(detectConnectionDeviations(connection, installed)).toEqual([])
  })
})

describe('detectRuDeviation', () => {
  it('flags a mismatched RU', () => {
    expect(detectRuDeviation({ ru: 40 }, 38)).toEqual({ field: 'ru', label: 'Rack / RU', designedValue: 40, installedValue: 38 })
  })
  it('reports no deviation when RU matches', () => {
    expect(detectRuDeviation({ ru: 40 }, 40)).toBeNull()
  })
})

describe('computeDeploymentPhaseStatus', () => {
  it('is not_started before anything is installed', () => {
    expect(computeDeploymentPhaseStatus([{ role: 'edge', status: 'planned' }])).toBe('not_started')
  })

  it('ignores the WAN circuit entirely', () => {
    expect(computeDeploymentPhaseStatus([{ role: 'wan-circuit', status: 'planned' }])).toBe('not_started')
  })

  it('is in_progress once some devices have started but not all are accepted', () => {
    expect(computeDeploymentPhaseStatus([{ role: 'edge', status: 'installed' }, { role: 'ap', status: 'planned' }])).toBe('in_progress')
  })

  it('is completed only once every real device is accepted or in_service', () => {
    expect(computeDeploymentPhaseStatus([{ role: 'edge', status: 'accepted' }, { role: 'ap', status: 'in_service' }])).toBe('completed')
    expect(computeDeploymentPhaseStatus([{ role: 'edge', status: 'accepted' }, { role: 'ap', status: 'tested' }])).toBe('in_progress')
  })
})

describe('computeDeploymentKpis', () => {
  it('excludes the WAN circuit from installable device counts', () => {
    const devices = [
      { role: 'wan-circuit', status: 'planned' },
      { role: 'fusion', status: 'installed' },
      { role: 'edge', status: 'planned' },
      { role: 'ap', status: 'tested' },
    ]
    const connections = [{ status: 'installed' }, { status: 'designed' }]
    const kpis = computeDeploymentKpis({ devices, connections, openExceptionCount: 2 })
    expect(kpis.totalDevices).toBe(3) // excludes wan-circuit
    expect(kpis.devicesInstalled).toBe(2) // fusion + ap
    expect(kpis.totalAps).toBe(1)
    expect(kpis.apsMounted).toBe(1)
    expect(kpis.uplinksLive).toBe(1)
    expect(kpis.overallProgress).toBe(67) // 2/3 rounded
    expect(kpis.openIssues).toBe(2)
  })
})

describe('checklistProgress', () => {
  it('counts completed items against the fixed §3.9.3 checklist', () => {
    const progress = checklistProgress({ 'rack-ru': true, labelled: true })
    expect(progress.done).toBe(2)
    expect(progress.total).toBe(6)
    expect(progress.complete).toBe(false)
  })
})
