// Cable length suggestion (brief v2.3 §6.3). Three situations, each with
// its own formula; the raw metres are then rounded UP to the nearest
// stock length for that media/situation. This is NexAI's cable-length
// rule, not a design choice left to the renders' illustrative "2 m".

const RACK_RU_PITCH_M = 0.045
const RACK_SAME_SLACK_M = 0.5
const ROOM_RACK_SPACING_M = 0.8
const ROOM_VERTICAL_ROUTING_M = 1.5
const ROOM_SLACK_M = 1
const CROSS_ROOM_SLACK_M = 2

const CAT6A_STOCK = {
  'same-rack': [0.3, 0.5, 1, 1.5, 2, 3],
  'same-room': [3, 5, 7, 10, 15],
  'cross-room': [15, 20, 30, 50, 75, 90],
}

const FLAT_STOCK = {
  os2: [5, 10, 15, 30, 50, 100, 200, 500],
  om4: [3, 5, 10, 15, 30, 50, 100],
  dac: [1, 2, 3, 5],
  stack: [0.5, 1, 3],
}

export const DEFAULT_MEDIA_LIMITS_M = {
  cat6a: 100,
  om4: 400,
  os2: 10000,
  dac: 5, // DAC/stack: the product's own fixed length; longest stock entry stands in as the default
  stack: 3,
}

export function determineSituation({ sourceRackId, destRackId, sourceRoomId, destRoomId }) {
  if (sourceRackId && destRackId && sourceRackId === destRackId) return 'same-rack'
  if (sourceRoomId && destRoomId && sourceRoomId === destRoomId) return 'same-room'
  return 'cross-room'
}

function computeRawLength(situation, params) {
  if (situation === 'same-rack') {
    const { ruSource, ruDest } = params
    return { meters: Math.abs(ruSource - ruDest) * RACK_RU_PITCH_M + RACK_SAME_SLACK_M, estimated: false }
  }
  if (situation === 'same-room') {
    const { rackPositionSource, rackPositionDest } = params
    return {
      meters: ROOM_RACK_SPACING_M * Math.abs(rackPositionSource - rackPositionDest) + ROOM_VERTICAL_ROUTING_M + ROOM_SLACK_M,
      estimated: false,
    }
  }
  // cross-room: needs a surveyed pathway length; without one the architect
  // must enter an estimate (§6.3), so there is no raw metres to compute.
  const { surveyedPathwayLength } = params
  if (surveyedPathwayLength == null) return { meters: null, estimated: true }
  return { meters: surveyedPathwayLength + CROSS_ROOM_SLACK_M, estimated: false }
}

// The brief's stock-length table (§6.3), the default of the organisation
// setting `stockLengths` (configurable by the Org Admin): Cat6A per
// situation, the other media one list each.
export const DEFAULT_STOCK_LENGTHS = { cat6a: CAT6A_STOCK, ...FLAT_STOCK }

function stockList(media, situation, table) {
  const t = table ?? DEFAULT_STOCK_LENGTHS
  const entry = t[media] ?? DEFAULT_STOCK_LENGTHS[media]
  if (!entry) return null
  return Array.isArray(entry) ? entry : (entry[situation] ?? null)
}

function roundUpToStock(media, situation, meters, table) {
  const list = stockList(media, situation, table)
  if (!list) return { stockLength: null, customLengthRequired: true }
  const match = list.find((v) => v >= meters)
  if (match === undefined) return { stockLength: null, customLengthRequired: true }
  return { stockLength: match, customLengthRequired: false }
}

// Returns { situation, rawMeters, suggested, estimated, customLengthRequired }.
// `suggested` is the stock length to offer as the default Engineer Selected
// value; it is null when the situation is cross-room with no surveyed
// pathway (estimated: true) or when no stock length is long enough
// (customLengthRequired: true).
// `stockLengths`: the organisation's table (DEFAULT_STOCK_LENGTHS shape); omitted = the default.
export function computeSuggestedLength({ source, dest, media, stockLengths = null }) {
  const situation = determineSituation({
    sourceRackId: source.rackId,
    destRackId: dest.rackId,
    sourceRoomId: source.roomId,
    destRoomId: dest.roomId,
  })

  const { meters: rawMeters } = computeRawLength(situation, {
    ruSource: source.ru,
    ruDest: dest.ru,
    rackPositionSource: source.rackPosition,
    rackPositionDest: dest.rackPosition,
    surveyedPathwayLength: dest.surveyedPathwayLength ?? source.surveyedPathwayLength,
  })

  if (rawMeters == null) {
    return { situation, rawMeters: null, suggested: null, estimated: true, customLengthRequired: false }
  }

  const { stockLength, customLengthRequired } = roundUpToStock(media, situation, rawMeters, stockLengths)
  return { situation, rawMeters, suggested: stockLength, estimated: false, customLengthRequired }
}

export function stockLengthsFor(media, situation, stockLengths = null) {
  return stockList(media, situation, stockLengths) ?? []
}
