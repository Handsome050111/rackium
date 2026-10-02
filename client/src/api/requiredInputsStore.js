// Solution Package Page 2 — Required Inputs register (brief v2.2 §3.7A.2,
// Step 7: "12 groups with owner, status, due date. Build a real form for
// group 1 (Network addressing & segmentation) with rule-based checks...
// Other groups: simple key/value forms.")
import { validateAddressingEntries } from '../lib/networkAddressingValidation.js'
import { registerStore, replaceObjectContents } from '../lib/persistentStore.js'

export const REQUIRED_INPUT_GROUPS = [
  { id: 'addressing', n: 1, name: 'Network addressing and segmentation' },
  { id: 'routing', n: 2, name: 'Routing and SD-WAN integration' },
  { id: 'catalyst-center', n: 3, name: 'Catalyst Center and LAN automation' },
  { id: 'central-services', n: 4, name: 'Central network services' },
  { id: 'security', n: 5, name: 'Security and management access' },
  { id: 'wireless', n: 6, name: 'Wireless and RF design' },
  { id: 'software', n: 7, name: 'Software and configuration standards' },
  { id: 'monitoring', n: 8, name: 'Monitoring and assurance' },
  { id: 'migration', n: 9, name: 'CMO-to-FMO migration' },
  { id: 'testing', n: 10, name: 'Testing and acceptance' },
  { id: 'commercial', n: 11, name: 'Commercial and procurement approval' },
  { id: 'governance', n: 12, name: 'Document governance and client approval' },
]

// buildingId -> state
const stores = {}

function storeFor(buildingId) {
  if (!stores[buildingId]) {
    stores[buildingId] = {
      meta: {}, // groupId -> { owner, dueDate }
      addressingEntries: [], // group 1: [{ id, label, vlanId, cidr, gateway }]
      kv: {}, // groupId -> [{ id, key, value }] for groups 2-12
    }
  }
  return stores[buildingId]
}

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

let idCounter = 1
function newId(prefix) {
  return `${prefix}-${Date.now()}-${idCounter++}`
}

registerStore('requiredInputsStore', {
  getSnapshot: () => ({ stores, idCounter }),
  restoreSnapshot: (data) => {
    replaceObjectContents(stores, data?.stores)
    if (typeof data?.idCounter === 'number') idCounter = data.idCounter
  },
})

function groupStatus(groupId, store) {
  if (groupId === 'addressing') {
    if (store.addressingEntries.length === 0) return 'not_started'
    const { ok } = validateAddressingEntries(store.addressingEntries)
    return ok ? 'complete' : 'in_progress'
  }
  const pairs = store.kv[groupId] ?? []
  if (pairs.length === 0) return 'not_started'
  const filled = pairs.filter((p) => p.key.trim() && p.value.trim())
  return filled.length === pairs.length && filled.length > 0 ? 'complete' : 'in_progress'
}

export async function getRequiredInputsContext(buildingId) {
  const store = storeFor(buildingId)
  const groups = REQUIRED_INPUT_GROUPS.map((g) => ({
    ...g,
    owner: store.meta[g.id]?.owner ?? null,
    dueDate: store.meta[g.id]?.dueDate ?? null,
    status: groupStatus(g.id, store),
    entryCount: g.id === 'addressing' ? store.addressingEntries.length : (store.kv[g.id] ?? []).length,
    kvPairs: g.id === 'addressing' ? null : [...(store.kv[g.id] ?? [])],
  }))
  const completeCount = groups.filter((g) => g.status === 'complete').length
  return resolveAfter({
    groups,
    addressingEntries: [...store.addressingEntries],
    addressingValidation: validateAddressingEntries(store.addressingEntries),
    completeCount,
    totalCount: groups.length,
    allComplete: completeCount === groups.length,
  })
}

export async function setGroupMeta(buildingId, groupId, meta) {
  const store = storeFor(buildingId)
  store.meta[groupId] = { ...store.meta[groupId], ...meta }
  return resolveAfter({ ...store.meta[groupId] })
}

export async function addAddressingEntry(buildingId, entry) {
  const store = storeFor(buildingId)
  const record = { id: newId('addr'), label: '', vlanId: '', cidr: '', gateway: '', ...entry }
  store.addressingEntries.push(record)
  return resolveAfter(record)
}

export async function updateAddressingEntry(buildingId, entryId, patch) {
  const store = storeFor(buildingId)
  const entry = store.addressingEntries.find((e) => e.id === entryId)
  if (entry) Object.assign(entry, patch)
  return resolveAfter(entry ? { ...entry } : null)
}

export async function removeAddressingEntry(buildingId, entryId) {
  const store = storeFor(buildingId)
  store.addressingEntries = store.addressingEntries.filter((e) => e.id !== entryId)
  return resolveAfter(true)
}

// Merges against this store's own current pairs, not a client-supplied
// snapshot — two quick edits (e.g. filling key then value) each resolve
// against the live array, so the second write can never silently discard
// the first (brief Step 7's "simple key/value forms" still need to behave
// correctly under fast typing/tabbing).
export async function updateKvPair(buildingId, groupId, pairId, patch) {
  const store = storeFor(buildingId)
  store.kv[groupId] ??= []
  const pair = store.kv[groupId].find((p) => p.id === pairId)
  if (pair) Object.assign(pair, patch)
  return resolveAfter(pair ? { ...pair } : null)
}

export async function removeKvPair(buildingId, groupId, pairId) {
  const store = storeFor(buildingId)
  store.kv[groupId] = (store.kv[groupId] ?? []).filter((p) => p.id !== pairId)
  return resolveAfter(true)
}

export async function addKvPair(buildingId, groupId) {
  const store = storeFor(buildingId)
  store.kv[groupId] ??= []
  const pair = { id: newId('kv'), key: '', value: '' }
  store.kv[groupId].push(pair)
  return resolveAfter(pair)
}
