import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.1 — one collection for every physical item, `origin`
// telling surveyed/imported gear (`existing`) from designed gear (`planned`)
// [D1]. M3a writes only existing devices, from the CMO import: imported
// devices are devices (M3a brief), not a separate cmoDevices collection.
//
// Fields the CMO import cannot know yet (role, category, rack placement) are
// optional here; the planned-device rules arrive with HLD (M4).
const deviceSchema = new mongoose.Schema({
  origin: { type: String, enum: ['existing', 'planned'], required: true },
  // Unassigned CMO devices have no building yet, but always a SAL (brief
  // v2.3 §5.1: "Unassigned list at SAL level").
  salId: { type: ObjectId, required: true, index: true },
  buildingId: { type: ObjectId, default: null, index: true },
  roomId: { type: ObjectId, default: null },
  rackId: { type: ObjectId, default: null },
  ru: { type: Number, default: null, min: 1 },
  // Rack placement (M3b Rack Survey). ru is the lowest RU; null for 0U items,
  // which sit on a rail instead (railSide).
  heightU: { type: Number, default: null, min: 0 },
  face: { type: String, enum: ['front', 'rear', null], default: null },
  fullDepth: { type: Boolean, default: false },
  mounting: { type: String, enum: ['rack', '0U', null], default: null },
  railSide: { type: String, enum: ['left', 'right', null], default: null },
  // What the surveyor placed: a library item ("24-port switch") or a CMO
  // device's own hostname. Generic items need no serial.
  category: { type: String, default: null },
  label: { type: String, default: null },
  sublabel: { type: String, default: null },
  hostname: { type: String, trim: true, default: null },
  model: { type: String, trim: true, default: null },
  // Set when `model` matches a catalogue item (vendor + model key).
  catalogueKey: { type: String, default: null },
  // HLD role (shared/hldRoles.js), set for planned devices (M4a) and for
  // existing gear the design uses. Null for survey-only items.
  role: { type: String, default: null },
  // Design layer of a planned device (M4b): 'hld', 'lld' (the LLD working
  // copy) or 'lld:<branchId>'. Null for existing (surveyed) gear, which every
  // design shares, and for HLD devices created before M4b (treated as 'hld').
  layer: { type: String, default: null },
  // The HLD device an LLD device was copied from (reconciliation).
  hldRef: { type: ObjectId, default: null },
  // PSUs configured on this device; defaults to the catalogue model's count (VAL-005).
  psuConfigured: { type: Number, default: null, min: 0 },
  // Existing gear starts in service [F5].
  status: { type: String, enum: ['planned', 'ordered', 'delivered', 'installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance', 'retired'], required: true },
  installation: {
    type: new mongoose.Schema({ serial: { type: String, default: null }, mac: { type: String, default: null } }, { _id: false }),
    default: () => ({}),
  },
  importBatchId: { type: ObjectId, default: null },
  assignedBy: { type: ObjectId, default: null },
  assignedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

deviceSchema.pre('validate', function plannedNeedsBuilding() {
  if (this.origin === 'planned' && !this.buildingId) this.invalidate('buildingId', 'A planned device belongs to a building')
})

deviceSchema.__modelName = 'Device'
tenantScope(deviceSchema, { scope: 'project' })

// DATA-MODEL §10.1: hostname unique per project, case-insensitive; MAC unique
// per project (normalised). Both are optional for imported gear, hence partial.
// M4b: per design layer — an LLD device keeps the hostname of the HLD device
// it was copied from. New hostnames are generated against every layer.
deviceSchema.index(
  { projectId: 1, layer: 1, hostname: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { hostname: { $type: 'string' } } }
)
deviceSchema.index({ projectId: 1, 'installation.mac': 1 }, { unique: true, partialFilterExpression: { 'installation.mac': { $type: 'string' } } })
deviceSchema.index({ projectId: 1, salId: 1, buildingId: 1 })

export const Device = mongoose.models.Device || mongoose.model('Device', deviceSchema)
