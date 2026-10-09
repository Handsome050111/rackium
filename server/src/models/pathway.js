import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.5: a room-to-room route (renamed from "building connection").
// The pair is unordered: the smaller id is stored first, so one route exists
// per pair whichever way it was drawn. Rooms may be in different buildings
// (brief §5.2), so both buildings are kept for scope checks and reads.
// shared/src/pathway.js and cableLength.js read these.
const pathwaySchema = new mongoose.Schema({
  roomLowId: { type: ObjectId, required: true },
  roomHighId: { type: ObjectId, required: true },
  buildingIds: { type: [ObjectId], required: true },
  routeStatus: { type: String, enum: ['surveyed', 'estimated'], default: 'estimated' },
  distanceM: { type: Number, default: null, min: 0 },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

pathwaySchema.__modelName = 'Pathway'
tenantScope(pathwaySchema, { scope: 'project' })

pathwaySchema.index({ projectId: 1, roomLowId: 1, roomHighId: 1 }, { unique: true })
pathwaySchema.index({ buildingIds: 1 })

export const Pathway = mongoose.models.Pathway || mongoose.model('Pathway', pathwaySchema)
