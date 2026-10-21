import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.10 (M7a-1): one building's phase must finish before another
// building's phase starts (v2.2 §21.7 "B001 must deploy before B002").
const endSchema = new mongoose.Schema({ buildingId: { type: ObjectId, required: true }, phaseKey: { type: String, required: true } }, { _id: false })
const buildingDependencySchema = new mongoose.Schema({
  from: { type: endSchema, required: true },
  to: { type: endSchema, required: true },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

buildingDependencySchema.__modelName = 'BuildingDependency'
tenantScope(buildingDependencySchema, { scope: 'project' })
buildingDependencySchema.index({ projectId: 1, 'from.buildingId': 1, 'from.phaseKey': 1, 'to.buildingId': 1, 'to.phaseKey': 1 }, { unique: true })

export const BuildingDependency = mongoose.models.BuildingDependency || mongoose.model('BuildingDependency', buildingDependencySchema)
