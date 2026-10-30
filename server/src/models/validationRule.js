import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { KEY_COLLATION } from './catalogueFields.js'

const { ObjectId } = mongoose.Schema.Types

// A custom validation rule (DATA-MODEL §3.11, D11; M7b-5): one condition on an
// allowlisted field (shared/customRules.js), no expression language. The value
// is stored typed, by the field. Organisation rules have no project; project
// rules are narrowed to the caller's project in the service, since an
// organisation-scoped model reads across the organisation's projects.
const validationRuleSchema = new mongoose.Schema({
  scope: { type: String, enum: ['organisation', 'project'], required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  object: { type: String, enum: ['device', 'connection', 'rack', 'room', 'pathway'], required: true },
  // A device rule may apply to one role only ("Edge has a single uplink"):
  // the rule's subject, not a second condition.
  subjectRole: { type: String, default: null },
  field: { type: String, required: true },
  operator: { type: String, enum: ['eq', 'neq', 'empty', 'notEmpty', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn'], required: true },
  valueString: { type: String, default: null },
  valueNumber: { type: Number, default: null },
  valueBoolean: { type: Boolean, default: null },
  valueList: { type: [String], default: undefined },
  severity: { type: String, enum: ['critical', 'warning', 'info'], required: true },
  message: { type: String, trim: true, maxlength: 300, default: null },
  enabled: { type: Boolean, default: true },
  createdBy: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

validationRuleSchema.__modelName = 'ValidationRule'
tenantScope(validationRuleSchema, { scope: 'organisation' })

validationRuleSchema.pre('validate', function levelMatchesProject() {
  if (this.scope === 'organisation' && this.projectId) this.invalidate('projectId', 'An organisation rule has no project')
  if (this.scope === 'project' && !this.projectId) this.invalidate('projectId', 'A project rule needs a project')
})

// One name per level, case-insensitively.
validationRuleSchema.index({ organisationId: 1, projectId: 1, name: 1 }, { unique: true, collation: KEY_COLLATION })

export const ValidationRule = mongoose.models.ValidationRule || mongoose.model('ValidationRule', validationRuleSchema)
