import { HandoverWorkflow } from '../models/handoverWorkflow.js'
import { conflict } from '../http/errors.js'

export const HANDED_OVER_MESSAGE = 'The handover was accepted — the design and deployment records are read-only. Use operational changes in the CMDB.'

// After the client accepts the handover (brief §5.9; M6b) the design phases
// and the deployment records are read-only; only CMDB operational edits remain.
export async function isHandedOver(buildingId, session = null) {
  if (!buildingId) return false
  return Boolean(await HandoverWorkflow.exists({ buildingId, state: 'accepted' }).session(session))
}
export async function assertNotHandedOver(buildingId, session = null) {
  if (await isHandedOver(buildingId, session)) throw conflict('handed_over', HANDED_OVER_MESSAGE)
}
