import mongoose from 'mongoose'

// DATA-MODEL §1.6. Deliberately NOT tenant-scoped: the client presents only a
// session id (no org/project in the URL to open a scope with), so the service
// looks this up directly and checks `actorUserId` against the authenticated
// caller itself — binding the session to the Org Admin who started it, and
// refusing it for anyone else, including another Org Admin of the same
// organisation (approval note, M2).
const viewAsSessionSchema = new mongoose.Schema({
  organisationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  viewedRole: { type: String, required: true },
  startedAt: { type: Date, default: () => new Date(), required: true },
  endedAt: { type: Date, default: null },
})

export const VIEW_AS_SESSION_TTL_MS = 60 * 60 * 1000 // 1 hour

export const ViewAsSession = mongoose.models.ViewAsSession || mongoose.model('ViewAsSession', viewAsSessionSchema)
