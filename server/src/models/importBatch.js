import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §4.6. The file itself is parsed in the browser (as the M2
// hierarchy import is) and posted as mapped rows, so there is no stored
// source file yet: `sourceFileId` waits for the files collection (§9);
// until then the batch keeps the file name.
const importBatchSchema = new mongoose.Schema({
  type: { type: String, enum: ['cmo', 'lifecycle'], required: true },
  salId: { type: mongoose.Schema.Types.ObjectId, default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  uploadedAt: { type: Date, default: () => new Date() },
  fileName: { type: String, default: null },
  sourceFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
  rowCount: { type: Number, required: true },
  status: { type: String, enum: ['previewed', 'committed', 'rejected'], required: true },
  summary: {
    type: new mongoose.Schema({ imported: Number, assigned: Number, unassigned: Number, skipped: Number }, { _id: false }),
    default: null,
  },
})

importBatchSchema.__modelName = 'ImportBatch'
tenantScope(importBatchSchema, { scope: 'project' })

export const ImportBatch = mongoose.models.ImportBatch || mongoose.model('ImportBatch', importBatchSchema)
