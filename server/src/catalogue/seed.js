import { catalogueItemSchema, catalogueKey } from '@rackium/shared/catalogue.js'
import { SEEDED_CATALOGUE } from '@rackium/shared/catalogueSeed.js'
import { PlatformCatalogueItem } from '../models/platformCatalogueItem.js'
import { KEY_COLLATION } from '../models/catalogueFields.js'

// Idempotent: inserts any seeded item that is missing and never touches one
// that exists, so a restart can't overwrite catalogue data that has since
// been corrected. Run on boot (index.js) and by the e2e test server.
export async function seedPlatformCatalogue() {
  let inserted = 0
  for (const raw of SEEDED_CATALOGUE) {
    const item = catalogueItemSchema.parse(raw)
    const key = catalogueKey(item)
    const result = await PlatformCatalogueItem.updateOne(
      { layer: 'seeded', kind: item.kind, key },
      { $setOnInsert: { ...item, layer: 'seeded', key, placeholder: true } },
      { upsert: true, collation: KEY_COLLATION }
    )
    inserted += result.upsertedCount
  }
  return { inserted, total: SEEDED_CATALOGUE.length }
}
