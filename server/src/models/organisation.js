import mongoose from 'mongoose'

// The tenancy root. Global: an organisation is itself the scope, so it is read
// through memberships rather than the tenant plugin.
const organisationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  defaultCurrency: { type: String, default: 'EUR', match: /^[A-Z]{3}$/ },
  settings: {
    cordLengthDefaultM: { type: Number, default: 2, min: 0.1 },
    uploadLimitsMb: {
      photo: { type: Number, default: 15 },
      pdf: { type: Number, default: 25 },
      sheet: { type: Number, default: 10 },
    },
    standardHeightsU: { type: [Number], default: [12, 24, 42, 45, 48] },
    customHeightsU: { type: [Number], default: [] },
  },
  createdAt: { type: Date, default: () => new Date() },
  deletedAt: { type: Date, default: null },
})

export const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', organisationSchema)
