import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.16 (M7a-2): an organisation's help for one field, over the
// platform default (shared/fieldHelp.js). Plain text only; photos are
// re-encoded without metadata before they are stored.
const photoSchema = new mongoose.Schema(
  {
    id: { type: ObjectId, required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    widthPx: { type: Number, default: null },
    heightPx: { type: Number, default: null },
    caption: { type: String, default: null },
    uploadedBy: { type: ObjectId, required: true },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
)

const fieldHelpSchema = new mongoose.Schema({
  key: { type: String, required: true },
  meaning: { type: String, default: null },
  lookFor: { type: String, default: null },
  example: { type: String, default: null },
  mistakes: { type: String, default: null },
  photos: { type: [photoSchema], default: [] },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

fieldHelpSchema.__modelName = 'FieldHelp'
tenantScope(fieldHelpSchema, { scope: 'organisation' })
fieldHelpSchema.index({ organisationId: 1, key: 1 }, { unique: true })

export const FieldHelp = mongoose.models.FieldHelp || mongoose.model('FieldHelp', fieldHelpSchema)
