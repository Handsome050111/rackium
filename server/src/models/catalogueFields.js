import mongoose from 'mongoose'
import { CATALOGUE_KINDS, CATALOGUE_CATEGORIES, MOUNTINGS, PORT_ROLES, OPTIC_MEDIA } from '@rackium/shared/catalogue.js'

// One field definition for both catalogue collections (platform layers and
// customer layers). Content rules are checked by the shared Zod schema
// (shared/src/catalogue.js) before anything reaches here; these are the
// storage types.
const portGroupSchema = new mongoose.Schema(
  {
    role: { type: String, enum: PORT_ROLES, required: true },
    type: { type: String, required: true },
    speed: { type: String, default: null },
    poe: { type: Boolean, default: false },
    count: { type: Number, required: true, min: 1 },
    start: { type: Number, required: true, min: 0 },
    pattern: { type: String, required: true },
  },
  { _id: false }
)

export function catalogueFields() {
  return {
    kind: { type: String, enum: CATALOGUE_KINDS, required: true },
    key: { type: String, required: true, trim: true },
    category: { type: String, enum: CATALOGUE_CATEGORIES, required: true },
    vendor: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    heightU: { type: Number, default: null },
    fullDepth: { type: Boolean, default: false },
    mounting: { type: String, enum: [...MOUNTINGS, null], default: null },
    rackMounted: { type: Boolean, default: false },
    weightKg: { type: Number, default: null },
    powerDrawW: { type: Number, default: null },
    powerInletType: { type: String, default: null },
    poeBudgetW: { type: Number, default: null },
    psuCount: { type: Number, default: null },
    needsUplinkModule: { type: Boolean, default: false },
    portMap: { type: new mongoose.Schema({ groups: { type: [portGroupSchema], default: [] } }, { _id: false }), default: null },
    mediaSpeed: {
      type: new mongoose.Schema({ media: { type: String, enum: OPTIC_MEDIA }, speed: String, reachM: Number }, { _id: false }),
      default: null,
    },
    compatibleSfps: { type: [String], default: [] },
    compatiblePsus: { type: [String], default: [] },
    compatibleModules: { type: [String], default: [] },
    unitPriceMinor: { type: Number, default: null },
    currency: { type: String, default: 'EUR' },
    servonAvailable: { type: Boolean, default: false },
    servonProductCode: { type: String, default: null },
    eosDate: { type: Date, default: null },
    eolDate: { type: Date, default: null },
    artworkFront: { type: String, default: null },
    artworkRear: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: () => new Date() },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedAt: { type: Date, default: () => new Date() },
  }
}

// Case-insensitive key identity (DATA-MODEL §4.7: "unique per layer and kind,
// case-insensitive").
export const KEY_COLLATION = { locale: 'en', strength: 2 }
