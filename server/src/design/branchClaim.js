import { DesignBranch } from '../models/designBranch.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { User } from '../models/user.js'
import { AppError, conflict } from '../http/errors.js'

// A change request's branch carries its HLD and LLD changes (layers
// 'hld:<id>' and 'lld:<id>'; M5a review) under ONE revision: an edit on either
// side claims the branch's next revision, and a stale one is refused.

// A change request's design can be edited while it is a draft or sent back.
export async function assertChangeRequestEditable(branch, session = null) {
  if (!branch?.changeRequestId) return
  const cr = await ChangeRequest.findById(branch.changeRequestId).session(session).lean()
  if (cr && !['draft', 'changes_requested'].includes(cr.status)) throw conflict('change_request_locked', `Change request CR-${cr.number} is ${cr.status.replace('_', ' ')} — its design can be edited again if changes are requested`)
}

export async function claimBranchRevision({ branchId, buildingId }, baseRevision, actor, session) {
  const updated = await DesignBranch.findOneAndUpdate({ _id: branchId, buildingId, status: 'open', revision: baseRevision }, { $inc: { revision: 1 }, $set: { lastEditedAt: new Date(), lastEditedBy: actor.userId } }, { session, returnDocument: 'after' })
  if (updated) return updated
  const current = await DesignBranch.findById(branchId).session(session)
  if (!current || current.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
  const who = current.lastEditedBy ? (await User.findById(current.lastEditedBy, { name: 1, email: 1 }).lean())?.name ?? 'someone' : 'someone'
  throw new AppError(409, 'stale_revision', `This branch was changed by ${who} since you loaded it (revision ${current.revision}, yours ${baseRevision}). Reload to see the latest, then make your change again.`, {
    revision: current.revision,
    lastEditedBy: who,
    lastEditedAt: current.lastEditedAt ?? null,
  })
}
