import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.3 [S3, S4]: one row per occupied port. The unique index is
// the port-assignment guarantee; rows are written in the same transaction as
// the connection (or hop) that takes the port.
const portOccupancySchema = new mongoose.Schema({
  deviceId: { type: ObjectId, required: true },
  portId: { type: String, required: true },
  // Case-insensitive identity of the port ("Te1/1/1" = "te1/1/1").
  portKey: { type: String, required: true },
  connectionId: { type: ObjectId, default: null },
  hopSeq: { type: Number, default: null },
  source: { type: String, enum: ['connection', 'hop', 'pre_occupied'], required: true },
  createdAt: { type: Date, default: () => new Date() },
})

portOccupancySchema.__modelName = 'PortOccupancy'
tenantScope(portOccupancySchema, { scope: 'project' })
portOccupancySchema.index({ projectId: 1, deviceId: 1, portKey: 1 }, { unique: true })
portOccupancySchema.index({ projectId: 1, connectionId: 1 })

export const PortOccupancy = mongoose.models.PortOccupancy || mongoose.model('PortOccupancy', portOccupancySchema)
