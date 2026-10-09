import { catalogueItemSchema, catalogueKey } from '@rackium/shared/catalogue.js'
import { SEEDED_CATALOGUE } from '@rackium/shared/catalogueSeed.js'
import { PlatformCatalogueItem } from '../models/platformCatalogueItem.js'
import { KEY_COLLATION } from '../models/catalogueFields.js'

// Idempotent: inserts any seeded item that is missing and never changes a
// value an existing one already has, so a restart can't overwrite catalogue
// data that has since been corrected. A field added to the seed later (e.g.
// requiresDualPsu, M4a review) is filled in where an existing item lacks it.
// Run on boot (index.js) and by the e2e test server.
export async function seedPlatformCatalogue() {
  let inserted = 0
  let backfilled = 0
  for (const raw of SEEDED_CATALOGUE) {
    const item = catalogueItemSchema.parse(raw)
    const key = catalogueKey(item)
    const filter = { layer: 'seeded', kind: item.kind, key }
    const existing = await PlatformCatalogueItem.findOne(filter).collation(KEY_COLLATION).lean()
    if (!existing) {
      const result = await PlatformCatalogueItem.updateOne(filter, { $setOnInsert: { ...item, layer: 'seeded', key, placeholder: true } }, { upsert: true, collation: KEY_COLLATION })
      inserted += result.upsertedCount
      continue
    }
    const missing = Object.fromEntries(Object.entries(item).filter(([field]) => !(field in existing)))
    if (Object.keys(missing).length) {
      await PlatformCatalogueItem.updateOne({ _id: existing._id }, { $set: missing })
      backfilled += 1
    }
  }
  return { inserted, backfilled, total: SEEDED_CATALOGUE.length }
}
