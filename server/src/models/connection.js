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
    // The panel sides the hop's two cables land on, set by cable type:
    // device↔panel (patch cord) → front, panel↔panel (trunk) → rear.
    inSide: { type: String, enum: ['front', 'rear', null], default: null },
    outSide: { type: String, enum: ['front', 'rear', null], default: null },
    // The cable after this panel (route segment seq; M5a review): its own
    // Engineer Selected and Installed length. Suggested is calculated.
    lengths: {
      engineerSelectedM: { type: Number, default: null },
      installedM: { type: Number, default: null },
    },
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
  // The design revision (of `layer`) that last changed this connection — so
  // a stale save on its ports can say which port changed and who changed it
  // (the save-time conflict check, addendum v2.3 Q2).
  edited: { type: new mongoose.Schema({ layer: String, revision: Number }, { _id: false }), default: null },
  // Reroute (DATA-MODEL §5.20): the rooms a cross-room cable passes through, in order.
  route: { type: new mongoose.Schema({ viaRoomIds: { type: [ObjectId], default: [] } }, { _id: false }), default: null },
  // Taken out of the design by an HLD tool (Break, Split, Merge) but kept for
  // the audit trail (addendum v2.3 Q1): no ports, no cable ID, read by nothing
  // but the HLD's broken-uplink list and validation (see the filter below).
  archived: {
    type: new mongoose.Schema(
      { tool: { type: String, enum: ['break', 'split', 'merge'], required: true }, reason: { type: String, default: null }, at: { type: Date, required: true }, by: { type: ObjectId, default: null }, byName: { type: String, default: null }, sourceName: { type: String, default: null }, destName: { type: String, default: null } },
      { _id: false }
    ),
    default: null,
  },
})

// Archived connections are out of the design: every query leaves them out
// unless it names `archived` itself (DATA-MODEL §5.20).
function liveOnly() {
  if (!Object.prototype.hasOwnProperty.call(this.getFilter(), 'archived')) this.where({ archived: null })
}
for (const op of ['find', 'findOne', 'countDocuments', 'distinct', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'replaceOne']) connectionSchema.pre(op, liveOnly)
connectionSchema.pre('aggregate', function liveOnlyAggregate() {
  if (!this.pipeline().some((stage) => stage.$match && Object.prototype.hasOwnProperty.call(stage.$match, 'archived'))) this.pipeline().unshift({ $match: { archived: null } })
})

connectionSchema.__modelName = 'Connection'
tenantScope(connectionSchema, { scope: 'project' })
connectionSchema.index({ projectId: 1, 'source.deviceId': 1 })
connectionSchema.index({ projectId: 1, 'dest.deviceId': 1 })
// Global search (M7a-2): the connections on a panel's ports.
connectionSchema.index({ projectId: 1, 'hops.patchPanelId': 1 })

export const Connection = mongoose.models.Connection || mongoose.model('Connection', connectionSchema)
