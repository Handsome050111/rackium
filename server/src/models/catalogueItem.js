import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { catalogueFields, KEY_COLLATION } from './catalogueFields.js'

// Customer catalogue layers (DATA-MODEL §4.8): `organisation` (Org Admin,
// projectId null) and `project` (projectId set). Organisation-scoped through
// the tenant plugin, so one organisation can never read another's items; the
// project layer is narrowed to the caller's project in the service, since an
// organisation-scoped model is readable across the organisation's projects.
const catalogueItemSchema = new mongoose.Schema({
  layer: { type: String, enum: ['organisation', 'project'], required: true },
  ...catalogueFields(),
})

catalogueItemSchema.__modelName = 'CatalogueItem'
tenantScope(catalogueItemSchema, { scope: 'organisation' })

catalogueItemSchema.pre('validate', function layerMatchesProject() {
  if (this.layer === 'organisation' && this.projectId) this.invalidate('projectId', 'An organisation item has no project')
  if (this.layer === 'project' && !this.projectId) this.invalidate('projectId', 'A project item needs a project')
})

catalogueItemSchema.index({ organisationId: 1, projectId: 1, kind: 1, key: 1 }, { unique: true, collation: KEY_COLLATION })

export const CatalogueItem = mongoose.models.CatalogueItem || mongoose.model('CatalogueItem', catalogueItemSchema)
