import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.12 (M6b): the immutable record of what the client accepted —
// written once, in the acceptance transaction, and never changed. Every
// update and delete is refused by the model itself.
const documentRefSchema = new mongoose.Schema({ documentId: ObjectId, typeKey: String, format: String, version: Number, fileName: String, sha256: String, sizeBytes: Number }, { _id: false })

const handoverBaselineSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  // v{n}.0, n counting accepted baselines of this building.
  number: { type: Number, required: true },
  label: { type: String, required: true },
  acceptedAt: { type: Date, required: true },
  approvalId: { type: ObjectId, required: true },
  client: { type: new mongoose.Schema({ name: String, role: String }, { _id: false }), required: true },
  designVersionIds: { type: new mongoose.Schema({ hld: ObjectId, lld: ObjectId, solutionPackage: ObjectId, bom: ObjectId }, { _id: false }), default: () => ({}) },
  documents: { type: [documentRefSchema], default: [] },
  packageDocumentId: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

handoverBaselineSchema.__modelName = 'HandoverBaseline'
tenantScope(handoverBaselineSchema, { scope: 'project' })
handoverBaselineSchema.index({ projectId: 1, buildingId: 1, number: 1 }, { unique: true })

const immutable = function refuse() {
  throw new Error('A handover baseline is immutable')
}
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) handoverBaselineSchema.pre(op, immutable)
handoverBaselineSchema.pre('save', function onlyNew() {
  if (!this.isNew) throw new Error('A handover baseline is immutable')
})

export const HandoverBaseline = mongoose.models.HandoverBaseline || mongoose.model('HandoverBaseline', handoverBaselineSchema)
