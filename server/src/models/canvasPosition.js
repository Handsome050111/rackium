import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// Where an object is drawn on a design canvas (M4a): kept apart from the
// device and connection records, so moving a box never touches the design.
// Coordinates are relative to the object's room box on the HLD canvas.
const canvasPositionSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  designType: { type: String, enum: ['hld'], default: 'hld' },
  objectType: { type: String, enum: ['device'], required: true },
  objectId: { type: ObjectId, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

canvasPositionSchema.__modelName = 'CanvasPosition'
tenantScope(canvasPositionSchema, { scope: 'project' })
canvasPositionSchema.index({ projectId: 1, buildingId: 1, designType: 1, objectType: 1, objectId: 1 }, { unique: true })

export const CanvasPosition = mongoose.models.CanvasPosition || mongoose.model('CanvasPosition', canvasPositionSchema)
