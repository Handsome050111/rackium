import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// The as-built record of one designed device (DATA-MODEL §4.1a–c, §5.2,
// §8.2; M6a). Kept apart from the frozen design: a change request promotes a
// branch by re-creating the main LLD's devices under their original ids, so
// installation data keyed by that id survives it. Before installation the
// device's status comes from its procurement line (planned/ordered/
// delivered); from installation on, from here.
const provenanceSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['design', 'manual', 'import', 'deployment'], required: true },
    setBy: { type: ObjectId, default: null },
    setByName: { type: String, default: null },
    setAt: { type: Date, default: () => new Date() },
    importBatchId: { type: ObjectId, default: null },
  },
  { _id: false }
)

const historySchema = new mongoose.Schema(
  { status: String, by: ObjectId, byName: String, at: { type: Date, default: () => new Date() }, note: { type: String, default: null } },
  { _id: false }
)

const deploymentRecordSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  deviceId: { type: ObjectId, required: true },
  // draft: something recorded, not yet installed. retired: an approved change
  // request removed the device from the design (M6a review).
  status: { type: String, enum: ['draft', 'installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance', 'retired'], default: 'draft' },
  // Set when retired: what it was, and the serial and MAC it released.
  retired: {
    type: new mongoose.Schema({ at: Date, reason: String, label: String, previousStatus: String, serial: String, mac: String }, { _id: false }),
    default: null,
  },
  installation: {
    serial: { type: String, default: null, trim: true },
    // Stored form: lower case, colon-separated (as the CMO import).
    mac: { type: String, default: null },
    rackId: { type: ObjectId, default: null },
    ru: { type: Number, default: null },
    face: { type: String, enum: ['front', 'rear', null], default: null },
    pduOutlet: { type: String, default: null },
    gps: { type: new mongoose.Schema({ lat: Number, lng: Number, accuracyM: { type: Number, default: null } }, { _id: false }), default: null },
    notes: { type: String, default: null },
    technicianId: { type: ObjectId, default: null },
    technicianName: { type: String, default: null },
    installedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
  },
  dguv: {
    lastInspectionDate: { type: String, default: null }, // YYYY-MM-DD
    inspector: { type: String, default: null },
    certificateFileId: { type: ObjectId, default: null },
    recordedBy: { type: ObjectId, default: null },
    recordedAt: { type: Date, default: null },
    // Reminder levels already sent for the current due date ('expiring_soon:2030-01-01').
    remindersSent: { type: [String], default: [] },
  },
  // The device's DGUV obligation overridden from its model's default
  // (addendum v2.3 Q13): `required` false = exempt; a reason is mandatory.
  dguvOverride: {
    type: new mongoose.Schema({ required: { type: Boolean, required: true }, reason: { type: String, required: true, maxlength: 500 }, setBy: ObjectId, setByName: String, setAt: Date }, { _id: false }),
    default: null,
  },
  lifecycle: {
    warrantyStart: { type: String, default: null },
    warrantyEnd: { type: String, default: null },
    refreshDate: { type: String, default: null },
  },
  assetTag: { type: String, default: null },
  notes: { type: String, default: null },
  // Field → where its value came from (DATA-MODEL §8.2).
  provenance: { type: Map, of: provenanceSchema, default: () => new Map() },
  history: { type: [historySchema], default: [] },
  acceptedBy: { type: ObjectId, default: null },
  acceptedAt: { type: Date, default: null },
  version: { type: Number, default: 0 },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

deploymentRecordSchema.__modelName = 'DeploymentRecord'
tenantScope(deploymentRecordSchema, { scope: 'project' })
deploymentRecordSchema.index({ projectId: 1, deviceId: 1 }, { unique: true })
// MAC unique per project among installed devices (CMO gear is checked in the service).
deploymentRecordSchema.index({ projectId: 1, 'installation.mac': 1 }, { unique: true, partialFilterExpression: { 'installation.mac': { $type: 'string' } } })
// Global search (M7a-2, DATA-MODEL §5.16): case-insensitive serial and asset ID.
deploymentRecordSchema.index({ projectId: 1, 'installation.serial': 1 }, { collation: { locale: 'en', strength: 2 } })
deploymentRecordSchema.index({ projectId: 1, assetTag: 1 }, { collation: { locale: 'en', strength: 2 } })

export const DeploymentRecord = mongoose.models.DeploymentRecord || mongoose.model('DeploymentRecord', deploymentRecordSchema)
