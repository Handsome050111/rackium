import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.3 [S3, S4, D7]: a device-to-device link. HLD works at
// device/uplink level (ports optional, brief §5.3); LLD fills ports, hops and
// cable IDs on the same records. Port and cable-ID uniqueness live in the
// portOccupancy and cableIdRegistry collections, written in the same
// transaction as the connection.
const endSchema = new mongoose.Schema({ deviceId: { type: ObjectId, required: true }, portId: { type: String, default: null } }, { _id: false })

const hopSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true, min: 1 },
    patchPanelId: { type: ObjectId, required: true },
    inPort: { type: String, required: true },
    outPort: { type: String, required: true },
    roomId: { type: ObjectId, default: null },
    rackId: { type: ObjectId, default: null },
    ru: { type: Number, default: null },
    segmentCableId: { type: String, default: null },
  },
  { _id: false }
)

export const CONNECTION_MEDIA = ['os2', 'om4', 'cat6a', 'stack', 'dac']
export const CONNECTION_SPEEDS = ['1G', '2.5G', '10G', '25G', '40G', '100G']

const connectionSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  // Design layer (M4b): 'hld', 'lld' or 'lld:<branchId>'; null = 'hld' (pre-M4b rows).
  layer: { type: String, default: null },
  // The HLD uplink an LLD connection was copied from (reconciliation).
  hldRef: { type: ObjectId, default: null },
  // On a branch copy: the main-LLD connection it came from (it may keep that
  // connection's cable IDs, nothing else).
  originId: { type: ObjectId, default: null },
  source: { type: endSchema, required: true },
  dest: { type: endSchema, required: true },
  media: { type: String, enum: CONNECTION_MEDIA, required: true },
  speed: { type: String, enum: CONNECTION_SPEEDS, required: true },
  sourceSfpCode: { type: String, default: null },
  destSfpCode: { type: String, default: null },
  // Routed through the destination room's patch panel (HLD intent; LLD adds the hops).
  viaPatchPanel: { type: Boolean, default: false },
  cableId: { type: String, default: null, trim: true },
  hops: { type: [hopSchema], default: [] },
  lengths: {
    suggestedM: { type: Number, default: null },
    engineerSelectedM: { type: Number, default: null },
    installedM: { type: Number, default: null },
  },
  status: { type: String, enum: ['designed', 'approved', 'installed', 'tested', 'accepted', 'in_service', 'faulty', 'decommissioned'], default: 'designed' },
  testResult: { type: String, enum: ['pass', 'fail', null], default: null },
  createdBy: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

connectionSchema.__modelName = 'Connection'
tenantScope(connectionSchema, { scope: 'project' })
connectionSchema.index({ projectId: 1, 'source.deviceId': 1 })
connectionSchema.index({ projectId: 1, 'dest.deviceId': 1 })

export const Connection = mongoose.models.Connection || mongoose.model('Connection', connectionSchema)
