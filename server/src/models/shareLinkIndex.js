import mongoose from 'mongoose'

// Global and deliberately content-free (M5a): a public approval link carries
// only its token, so this maps the token's SHA-256 to the tenant scope and
// the share link id. Everything about the link and the package is read from
// the tenant-scoped collections inside that scope.
const shareLinkIndexSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true },
  organisationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, required: true },
  shareLinkId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})
shareLinkIndexSchema.index({ tokenHash: 1 }, { unique: true })

export const ShareLinkIndex = mongoose.models.ShareLinkIndex || mongoose.model('ShareLinkIndex', shareLinkIndexSchema)
