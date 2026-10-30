// Custom validation rules (M7b-5, DATA-MODEL §3.11, D11; v2.2 §3.4): a
// structured builder, never an expression language. IF [subject] [one
// condition] THEN [severity] [message]. Subjects and fields are an allowlist,
// and a message is filled as plain text: nothing a rule holds is ever run.
// Rules run alongside the built-in rules, on the design's own data.
import { expandPortMap } from './catalogue.js'
import { HLD_ROLES } from './hldRoles.js'
import { MODE_STATES } from './modeState.js'

export const RULE_SEVERITIES = ['critical', 'warning', 'info']
export const RULE_OPERATORS = ['eq', 'neq', 'empty', 'notEmpty', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn']
export const OPERATOR_LABEL = { eq: 'is', neq: 'is not', empty: 'is empty', notEmpty: 'is not empty', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', in: 'is one of', notIn: 'is none of' }
const NO_VALUE = new Set(['empty', 'notEmpty'])
const LIST_VALUE = new Set(['in', 'notIn'])
const OPERATORS_BY_TYPE = {
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'],
  text: ['eq', 'neq', 'in', 'notIn', 'empty', 'notEmpty'],
  enum: ['eq', 'neq', 'in', 'notIn', 'empty', 'notEmpty'],
  boolean: ['eq', 'neq'],
}
export const operatorsFor = (type) => OPERATORS_BY_TYPE[type] ?? []
export const operatorTakesValue = (operator) => !NO_VALUE.has(operator)
export const operatorTakesList = (operator) => LIST_VALUE.has(operator)

const has = (v) => v != null && v !== ''
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null)
const isPdu = (d, item) => d.role === 'pdu' || item?.category === 'pdu' || /pdu/i.test(d.label ?? '')

// The allowlist: each object's fields, with how to read each from the design.
// `env` carries what is calculated once per run (see buildEnv).
export const RULE_OBJECTS = {
  device: {
    label: 'Device',
    fields: {
      role: { label: 'Role', type: 'enum', options: HLD_ROLES.map((r) => ({ value: r.role, label: r.label })), get: (d) => d.role },
      modeState: { label: 'Mode state', type: 'enum', modeLabels: true, options: MODE_STATES.map((s) => ({ value: s, label: s })), get: (d) => d.modeState },
      hostname: { label: 'Hostname', type: 'text', get: (d) => d.hostname },
      model: { label: 'Model', type: 'text', get: (d) => d.model },
      placed: { label: 'Placed in a rack at an RU', type: 'boolean', get: (d) => Boolean(d.rackId && d.ru != null) },
      uplinkCount: { label: 'Uplink count', type: 'number', get: (d, env) => env.uplinks.get(String(d.id)) ?? 0 },
      portCount: { label: 'Port count', type: 'number', get: (d, env) => env.portsOf(d) },
      psuConfigured: { label: 'PSUs configured', type: 'number', get: (d) => d.psuConfigured },
      psuSlots: { label: 'PSU slots (catalogue)', type: 'number', get: (d, env) => env.itemOf(d)?.psuCount },
      powerDrawW: { label: 'Power draw (W)', type: 'number', get: (d, env) => env.itemOf(d)?.powerDrawW },
      weightKg: { label: 'Weight (kg)', type: 'number', get: (d, env) => env.itemOf(d)?.weightKg },
    },
    placeholders: { hostname: (d) => d.hostname ?? d.label, role: (d) => d.role, model: (d) => d.model, psu_count: (d) => d.psuConfigured, psu_slots: (d, env) => env.itemOf(d)?.psuCount },
    name: (d) => d.hostname ?? d.label ?? 'device',
  },
  connection: {
    label: 'Connection',
    fields: {
      media: { label: 'Media', type: 'enum', options: ['os2', 'om4', 'cat6a', 'stack', 'dac'].map((v) => ({ value: v, label: v.toUpperCase() })), get: (c) => c.media },
      speed: { label: 'Speed', type: 'enum', options: ['1G', '2.5G', '10G', '25G', '40G', '100G'].map((v) => ({ value: v, label: v })), get: (c) => c.speed },
      lengthM: { label: 'Cable length (m)', type: 'number', get: (c) => c.lengthM },
      lengthEstimated: { label: 'Length is estimated', type: 'boolean', get: (c) => Boolean(c.lengthEstimated) },
      cableId: { label: 'Cable ID', type: 'text', get: (c) => c.cableId },
      viaPatchPanel: { label: 'Via a patch panel', type: 'boolean', get: (c) => Boolean(c.viaPatchPanel || c.hops?.length) },
      hopCount: { label: 'Patch-panel hops', type: 'number', get: (c) => c.hops?.length ?? 0 },
      modeState: { label: 'Mode state', type: 'enum', modeLabels: true, options: ['interim', 'future'].map((s) => ({ value: s, label: s })), get: (c) => c.modeState ?? 'future' },
    },
    placeholders: { link_id: (c, env) => c.cableId ?? env.linkName(c), length: (c) => c.lengthM, media: (c) => c.media, speed: (c) => c.speed },
    name: (c, env) => c.cableId ?? env.linkName(c),
  },
  rack: {
    label: 'Rack',
    fields: {
      code: { label: 'Rack code', type: 'text', get: (r) => r.code },
      heightU: { label: 'Height (U)', type: 'number', get: (r) => r.heightU },
      deviceCount: { label: 'Device count', type: 'number', get: (r, env) => env.inRack(r).length },
      pduCount: { label: 'PDU count', type: 'number', get: (r, env) => env.inRack(r).filter((d) => isPdu(d, env.itemOf(d))).length },
      weightKg: { label: 'Weight (kg)', type: 'number', get: (r, env) => env.inRack(r).reduce((sum, d) => sum + (env.itemOf(d)?.weightKg ?? 0), 0) },
      powerDrawW: { label: 'Power draw (W)', type: 'number', get: (r, env) => env.inRack(r).reduce((sum, d) => sum + (env.itemOf(d)?.powerDrawW ?? 0), 0) },
      occupancyPct: { label: 'U occupancy (%)', type: 'number', get: (r, env) => pct(env.inRack(r).reduce((sum, d) => sum + (d.ru != null ? d.heightU ?? 0 : 0), 0), r.heightU) },
    },
    placeholders: { rack_label: (r) => r.code },
    name: (r) => `Rack ${r.code}`,
  },
  room: {
    label: 'Room',
    fields: {
      code: { label: 'Room code', type: 'text', get: (r) => r.code },
      isMainRoom: { label: 'Main room', type: 'boolean', get: (r) => Boolean(r.isMainRoom) },
      rackCount: { label: 'Rack count', type: 'number', get: (r, env) => env.racks.filter((k) => String(k.roomId) === String(r.id)).length },
      deviceCount: { label: 'Device count', type: 'number', get: (r, env) => env.devices.filter((d) => String(d.roomId) === String(r.id)).length },
    },
    placeholders: { room_code: (r) => r.code },
    name: (r) => `Room ${r.code}`,
  },
  pathway: {
    label: 'Pathway',
    fields: {
      routeStatus: { label: 'Route status', type: 'enum', options: ['surveyed', 'estimated'].map((v) => ({ value: v, label: v })), get: (p) => p.routeStatus },
      distanceM: { label: 'Distance (m)', type: 'number', get: (p) => p.distanceM },
    },
    placeholders: { from: (p, env) => env.roomCode(p.fromRoomId), to: (p, env) => env.roomCode(p.toRoomId) },
    name: (p, env) => `Pathway ${env.roomCode(p.fromRoomId)} – ${env.roomCode(p.toRoomId)}`,
  },
}

// Lookups on the allowlist, own keys only: "constructor" is no object or field.
export const ruleObject = (name) => (Object.hasOwn(RULE_OBJECTS, String(name)) ? RULE_OBJECTS[name] : null)
export const ruleField = (object, field) => {
  const fields = ruleObject(object)?.fields
  return fields && Object.hasOwn(fields, String(field)) ? fields[field] : null
}

// The placeholders a rule's message may use: {value} (what the field holds)
// and the object's own.
export const placeholdersOf = (object) => ['value', ...Object.keys(ruleObject(object)?.placeholders ?? {})]

// The values a field can take, as the builder lists them: mode states in the
// project's words. Null for a free value.
export function fieldOptions(field, labels = null) {
  if (!field?.options) return null
  return field.modeLabels && labels ? field.options.map((o) => ({ value: o.value, label: labels[o.value] ?? o.label })) : field.options
}

// A rule in words: "Device (Edge) · Uplink count is less than 2".
export function describeRule(rule, labels = null) {
  const object = ruleObject(rule.object)
  const field = ruleField(rule.object, rule.field)
  const role = rule.subjectRole ? HLD_ROLES.find((r) => r.role === rule.subjectRole)?.label ?? rule.subjectRole : null
  const shown = (v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : fieldOptions(field, labels)?.find((o) => o.value === v)?.label ?? v)
  const value = rule.value == null ? '' : ` ${Array.isArray(rule.value) ? rule.value.map(shown).join(', ') : shown(rule.value)}`
  return `${object?.label ?? rule.object}${role ? ` (${role})` : ''} · ${field?.label ?? rule.field} ${OPERATOR_LABEL[rule.operator] ?? rule.operator}${value}`
}

// Why a rule cannot be saved: [{ path, message }], empty when it can. One
// definition for the contract (server) and the builder (client).
export function ruleProblems(rule) {
  const out = []
  const add = (path, message) => out.push({ path, message })
  const object = ruleObject(rule.object)
  if (!object) return [{ path: 'object', message: 'Choose what the rule checks' }]
  if (rule.subjectRole && rule.object !== 'device') add('subjectRole', 'Only a device rule can apply to one role')
  if (rule.subjectRole && !HLD_ROLES.some((r) => r.role === rule.subjectRole)) add('subjectRole', 'Unknown role')
  const field = ruleField(rule.object, rule.field)
  if (!field) {
    add('field', `Choose a field of a ${object.label.toLowerCase()}`)
    return out
  }
  if (!operatorsFor(field.type).includes(rule.operator)) {
    add('operator', `"${field.label}" cannot be compared that way`)
    return out
  }
  const value = rule.value
  if (NO_VALUE.has(rule.operator)) {
    if (value != null) add('value', 'This condition takes no value')
  } else if (LIST_VALUE.has(rule.operator)) {
    if (!Array.isArray(value) || !value.length || value.some((v) => typeof v !== 'string' || !v.trim())) add('value', 'List at least one value')
    else if (field.type === 'enum') {
      const bad = value.find((v) => !field.options.some((o) => o.value === v))
      if (bad) add('value', `"${bad}" is not a value of ${field.label}`)
    }
  } else if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) add('value', 'Enter a number')
  } else if (field.type === 'boolean') {
    if (typeof value !== 'boolean') add('value', 'Choose yes or no')
  } else if (typeof value !== 'string' || !value.trim()) {
    add('value', 'Enter a value')
  } else if (field.type === 'enum' && !field.options.some((o) => o.value === value)) {
    add('value', `"${value}" is not a value of ${field.label}`)
  }
  for (const [, name] of String(rule.message ?? '').matchAll(/\{([^{}]*)\}/g)) {
    if (!placeholdersOf(rule.object).includes(name)) add('message', `{${name}} is not available here — use ${placeholdersOf(rule.object).map((p) => `{${p}}`).join(', ')}`)
  }
  return out
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

// Does a field's value meet the condition? A rule whose input does not exist
// is not applicable rather than guessed, as for the built-in rules: only
// `empty` holds on a value that is not there.
export function conditionHolds(actual, operator, value) {
  if (operator === 'empty') return !has(actual)
  if (operator === 'notEmpty') return has(actual)
  if (!has(actual)) return false
  switch (operator) {
    case 'eq':
      return typeof actual === 'number' ? actual === value : typeof actual === 'boolean' ? actual === value : same(actual, value)
    case 'neq':
      return typeof actual === 'number' ? actual !== value : typeof actual === 'boolean' ? actual !== value : !same(actual, value)
    case 'gt':
      return actual > value
    case 'gte':
      return actual >= value
    case 'lt':
      return actual < value
    case 'lte':
      return actual <= value
    case 'in':
      return (value ?? []).some((v) => same(actual, v))
    case 'notIn':
      return !(value ?? []).some((v) => same(actual, v))
    default:
      return false
  }
}

// A message's placeholders replaced by plain text; what is not known reads "—".
export const fillMessage = (template, values) => String(template).replace(/\{([a-z_]+)\}/g, (_, name) => (Object.hasOwn(values, name) && has(values[name]) ? String(values[name]) : '—'))

const round = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)

// What is calculated once per run, from the whole design. Rack and room
// figures count everything there, surveyed gear too; the rules themselves run
// on the design's own devices.
function buildEnv({ devices = [], connections = [], racks = [], rooms = [] }, ctx) {
  const uplinks = new Map()
  for (const c of connections) for (const end of [c.source, c.dest]) uplinks.set(String(end.deviceId), (uplinks.get(String(end.deviceId)) ?? 0) + 1)
  const byId = new Map(devices.map((d) => [String(d.id), d]))
  const nameOf = (id) => {
    const d = byId.get(String(id))
    return d?.hostname ?? d?.label ?? 'device'
  }
  const itemOf = (d) => ctx.itemOf?.(d) ?? null
  return {
    devices,
    racks,
    uplinks,
    itemOf,
    portsOf: (d) => {
      const item = itemOf(d)
      return item?.portMap ? expandPortMap(item.portMap).length : null
    },
    inRack: (r) => devices.filter((d) => String(d.rackId) === String(r.id)),
    roomCode: (id) => rooms.find((r) => String(r.id) === String(id))?.code ?? '?',
    linkName: (c) => `${nameOf(c.source.deviceId)} → ${nameOf(c.dest.deviceId)}`,
  }
}

// The records each object's rules run on. `design`: { devices, connections,
// racks, rooms, pathways }; only the design's own devices (not surveyed gear).
const subjectsOf = (object, design) => {
  if (object === 'device') return (design.devices ?? []).filter((d) => d.origin === 'planned').map((d) => [String(d.id), d])
  if (object === 'connection') return (design.connections ?? []).map((c) => [String(c.id), c])
  if (object === 'rack') return (design.racks ?? []).map((r) => [String(r.id), r])
  if (object === 'room') return (design.rooms ?? []).map((r) => [String(r.id), r])
  return (design.pathways ?? []).map((p) => [`${p.fromRoomId}|${p.toRoomId}`, p])
}

// Findings of the rules over a design, in the built-in findings' shape, with
// `custom: true` and the rule's name. `rules`: { id, name, scope, object,
// subjectRole, field, operator, value, severity, message }.
export function customRuleFindings(rules, design, ctx = {}) {
  if (!rules?.length) return []
  const env = buildEnv(design, ctx)
  const out = []
  for (const rule of rules) {
    const object = ruleObject(rule.object)
    const field = ruleField(rule.object, rule.field)
    if (!field) continue
    for (const [objectId, record] of subjectsOf(rule.object, design)) {
      if (rule.subjectRole && record.role !== rule.subjectRole) continue
      const actual = field.get(record, env)
      if (!conditionHolds(actual, rule.operator, rule.value)) continue
      const values = { value: round(actual), ...Object.fromEntries(Object.entries(object.placeholders).map(([k, get]) => [k, round(get(record, env))])) }
      out.push({
        id: `CUSTOM:${rule.id}:${rule.object}:${objectId}`,
        rule: 'Custom',
        custom: true,
        ruleId: String(rule.id),
        severity: rule.severity,
        title: rule.name,
        message: rule.message ? fillMessage(rule.message, values) : `${rule.name}: ${object.name(record, env)}`,
        objectType: rule.object,
        objectId,
      })
    }
  }
  return out
}
