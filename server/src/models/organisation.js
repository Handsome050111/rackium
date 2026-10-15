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
    // Brief v2.3 §4.3: "Architects can see prices only if the Org Admin grants it".
    architectsSeePrices: { type: Boolean, default: false },
    // Hostname role codes over the defaults (shared/hldRoles.js; M4a).
    namingRoleCodes: { type: Map, of: String, default: {} },
    // Cable stock lengths (shared/cableLength.js DEFAULT_STOCK_LENGTHS shape); null = the default table (M4b).
    stockLengths: { type: mongoose.Schema.Types.Mixed, default: null },
    // Cage nuts per RU on each face a device is fixed to (BOM; M5a review).
    // A device is fixed on its mounting face; a full-depth one on both.
    // The organisation's time zone (IANA; M5b review): task deadlines, due
    // soon / overdue and the daily digest's send time (local HH:MM).
    timeZone: { type: String, default: 'Europe/Berlin' },
    digestTime: { type: String, default: '07:00' },
    cageNutsPerRu: {
      front: { type: Number, default: 4, min: 0, max: 20 },
      rear: { type: Number, default: 4, min: 0, max: 20 },
    },
    // The organisation's logo on generated documents (M6b).
    logo: { type: new mongoose.Schema({ storageKey: String, mimeType: String, updatedAt: Date }, { _id: false }), default: null },
    // DGUV V3 inspection interval and warning windows (brief §6.9; M6a).
    dguv: {
      intervalMonths: { type: Number, default: 48, min: 1, max: 120 },
      expiringSoonDays: { type: Number, default: 90, min: 1, max: 365 },
      expiringDays: { type: Number, default: 30, min: 1, max: 365 },
    },
  },
  createdAt: { type: Date, default: () => new Date() },
  deletedAt: { type: Date, default: null },
})

export const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', organisationSchema)
