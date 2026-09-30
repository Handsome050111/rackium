// Serial/MAC validation against the CMO list (brief v2.3 §5.1, §5.2 item 3):
// Validated (found in CMO), Not in CMO, or Duplicate (already used
// elsewhere in the project). Plain rule checks — no OCR, no confidence
// scores.

export function matchSerial(serial, roomCmoList, allProjectSerials, excludeDeviceId = null) {
  const normalized = serial.trim().toLowerCase()
  if (normalized.length === 0) return null

  const duplicateElsewhere = allProjectSerials.some(
    (entry) => entry.deviceId !== excludeDeviceId && entry.serial.trim().toLowerCase() === normalized
  )
  if (duplicateElsewhere) return 'duplicate'

  const inCmo = roomCmoList.some((entry) => entry.serial.trim().toLowerCase() === normalized)
  return inCmo ? 'validated' : 'not-in-cmo'
}

export const CMO_STATUS_LABEL = {
  validated: 'Validated',
  'not-in-cmo': 'Not in CMO',
  duplicate: 'Duplicate',
}
