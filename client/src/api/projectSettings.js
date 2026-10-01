// PM-editable mock project settings: Bill of Resources standard minutes
// per task, and the BOM margin % (brief Step 7 / v2.3 §5.5-§5.6).
import { RESOURCE_TASKS } from '../lib/billOfResources.js'

const state = {
  resourceMinutes: Object.fromEntries(RESOURCE_TASKS.map((t) => [t.id, t.defaultMinutes])),
  marginPercent: 15,
}

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export async function getResourceMinutes() {
  return resolveAfter({ ...state.resourceMinutes })
}

export async function setResourceMinutes(taskId, minutes) {
  state.resourceMinutes[taskId] = minutes
  return resolveAfter({ ...state.resourceMinutes })
}

export async function getMarginPercent() {
  return resolveAfter(state.marginPercent)
}

export async function setMarginPercent(percent) {
  state.marginPercent = percent
  return resolveAfter(state.marginPercent)
}
