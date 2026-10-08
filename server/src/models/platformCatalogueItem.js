import mongoose from 'mongoose'
import { PLATFORM_LAYERS } from '@rackium/shared/catalogue.js'
import { catalogueFields, KEY_COLLATION } from './catalogueFields.js'

// Global, platform-owned catalogue layers: `seeded` (Rackium Team) and
// `servon` (DATA-MODEL §1.3: global, read-only to customers). No tenant
// plugin — these rows belong to no organisation. No customer route writes
// here; the only writer is the seed (catalogue/seed.js). Customer layers live
// in CatalogueItem, behind the tenant plugin.
const platformCatalogueItemSchema = new mongoose.Schema({
  layer: { type: String, enum: PLATFORM_LAYERS, required: true },
  // Seed rows carried over from the prototype until Technonex supplies the
  // real catalogue (brief §6.5) — shown as placeholders in the UI.
  placeholder: { type: Boolean, default: false },
  ...catalogueFields(),
})

platformCatalogueItemSchema.index({ layer: 1, kind: 1, key: 1 }, { unique: true, collation: KEY_COLLATION })

export const PlatformCatalogueItem = mongoose.models.PlatformCatalogueItem || mongoose.model('PlatformCatalogueItem', platformCatalogueItemSchema)
