import mongoose from 'mongoose'
import {
  catalogueKey,
  resolveCatalogueLayers,
  filterCatalogue,
  validateCatalogueRows,
  categoryGroupOf,
  expandPortMap,
} from '@rackium/shared/catalogue.js'
import { PlatformCatalogueItem } from '../models/platformCatalogueItem.js'
import { CatalogueItem } from '../models/catalogueItem.js'
import { KEY_COLLATION } from '../models/catalogueFields.js'
import { withTransaction } from '../db/transaction.js'
import { recordAudit, userActor, diffChanges } from '../audit/audit.js'
import { notFound, forbidden, badRequest, conflict } from '../http/errors.js'

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

const EDITABLE_FIELDS = [
  'kind', 'category', 'vendor', 'model', 'description', 'heightU', 'fullDepth', 'mounting', 'rackMounted', 'weightKg', 'powerDrawW',
  'powerInletType', 'poeBudgetW', 'psuCount', 'needsUplinkModule', 'portMap', 'mediaSpeed', 'compatibleSfps', 'compatiblePsus',
  'compatibleModules', 'unitPriceMinor', 'currency', 'servonAvailable', 'servonProductCode', 'eosDate', 'eolDate', 'artworkFront', 'artworkRear',
]

// Prices are visible only to the roles brief v2.3 §4.3 lists (ACTIONS.
// SEE_PRICES_MARGINS); for everyone else they are removed here, server-side,
// not just hidden in the UI.
function toItem(doc, { showPrices }) {
  const portMap = doc.portMap?.groups?.length ? { groups: doc.portMap.groups.map(({ role, type, speed, poe, count, start, pattern }) => ({ role, type, speed: speed ?? null, poe: Boolean(poe), count, start, pattern })) } : null
  return {
    id: String(doc._id),
    layer: doc.layer,
    placeholder: Boolean(doc.placeholder),
    kind: doc.kind,
    key: doc.key,
    category: doc.category,
    group: categoryGroupOf(doc.category),
    vendor: doc.vendor,
    model: doc.model,
    description: doc.description ?? null,
    heightU: doc.heightU ?? null,
    fullDepth: Boolean(doc.fullDepth),
    mounting: doc.mounting ?? null,
    rackMounted: Boolean(doc.rackMounted),
    weightKg: doc.weightKg ?? null,
    powerDrawW: doc.powerDrawW ?? null,
    powerInletType: doc.powerInletType ?? null,
    poeBudgetW: doc.poeBudgetW ?? null,
    psuCount: doc.psuCount ?? null,
    needsUplinkModule: Boolean(doc.needsUplinkModule),
    portMap,
    mediaSpeed: doc.mediaSpeed?.media ? { media: doc.mediaSpeed.media, speed: doc.mediaSpeed.speed, reachM: doc.mediaSpeed.reachM } : null,
    compatibleSfps: doc.compatibleSfps ?? [],
    compatiblePsus: doc.compatiblePsus ?? [],
    compatibleModules: doc.compatibleModules ?? [],
    unitPriceMinor: showPrices ? doc.unitPriceMinor ?? null : null,
    currency: showPrices ? doc.currency ?? null : null,
    priceHidden: !showPrices,
    servonAvailable: Boolean(doc.servonAvailable),
    servonProductCode: doc.servonProductCode ?? null,
    eosDate: dateOnly(doc.eosDate),
    eolDate: dateOnly(doc.eolDate),
    artworkFront: doc.artworkFront ?? null,
    artworkRear: doc.artworkRear ?? null,
    updatedAt: doc.updatedAt ?? null,
  }
}

// Every item visible from this context: both platform layers, the
// organisation layer, and the project layer of one project when given. The
// tenant plugin (request scope: this organisation) already confines the
// customer layers; the project layer is narrowed here to the one project.
async function visibleDocs(projectId) {
  const customerFilter = projectId ? { $or: [{ layer: 'organisation' }, { layer: 'project', projectId }] } : { layer: 'organisation' }
  const [platform, customer] = await Promise.all([PlatformCatalogueItem.find().lean(), CatalogueItem.find(customerFilter).lean()])
  return [...platform, ...customer]
}

// The project's resolved catalogue (most specific layer per key), without
// prices — what the HLD places devices from and validates against (M4a).
export async function projectCatalogue(projectId) {
  return resolveCatalogueLayers((await visibleDocs(projectId)).map((d) => toItem(d, { showPrices: false })))
}

function duplicateKeyError(err, key) {
  if (err?.code === 11000) return conflict('duplicate_item', `${key} is already in your organisation's catalogue`)
  return err
}

export function createCatalogueService() {
  return {
    async list({ projectId = null, filters = {}, showPrices }) {
      const items = (await visibleDocs(projectId)).map((d) => toItem(d, { showPrices }))
      const resolved = resolveCatalogueLayers(items)
      const vendors = [...new Set(resolved.map((i) => i.vendor))].sort()
      return { items: filterCatalogue(resolved, filters), vendors, total: resolved.length }
    },

    async get({ id, projectId = null, showPrices }) {
      if (!mongoose.isValidObjectId(id)) throw notFound('Catalogue item not found')
      const doc = (await PlatformCatalogueItem.findById(id).lean()) ?? (await CatalogueItem.findById(id).lean())
      if (!doc || (doc.layer === 'project' && String(doc.projectId) !== String(projectId))) throw notFound('Catalogue item not found')
      const item = toItem(doc, { showPrices })
      const sameIdentity = (await visibleDocs(projectId))
        .map((d) => toItem(d, { showPrices }))
        .filter((d) => d.kind === item.kind && d.key.toLowerCase() === item.key.toLowerCase())
      const [effective] = resolveCatalogueLayers(sameIdentity)
      return {
        item,
        ports: expandPortMap(item.portMap),
        layers: sameIdentity.map((d) => ({ id: d.id, layer: d.layer })),
        effectiveId: effective.id,
      }
    },

    async create({ organisationId, actor, body }) {
      const key = catalogueKey(body)
      let doc
      try {
        doc = await CatalogueItem.create({ ...body, key, layer: 'organisation', createdBy: actor.userId, updatedBy: actor.userId })
      } catch (err) {
        throw duplicateKeyError(err, key)
      }
      await recordAudit({
        organisationId,
        actor: userActor(actor.userId, actor.role),
        action: 'catalogue.item.created',
        objectType: 'CatalogueItem',
        objectId: doc._id,
        changeType: 'design_intent',
        source: 'ui',
      })
      return toItem(doc.toObject(), { showPrices: true })
    },

    // Replaces an organisation item. Platform items (seeded, SERVON) are
    // read-only to customers (DATA-MODEL §1.3); to change one, an Org Admin
    // adds an organisation item with the same vendor and model, which
    // overrides it.
    async replace({ organisationId, actor, id, body }) {
      if (!mongoose.isValidObjectId(id)) throw notFound('Catalogue item not found')
      if (await PlatformCatalogueItem.exists({ _id: id })) {
        throw forbidden('Seeded catalogue items are read-only. Add an organisation item with the same vendor and model to override it.')
      }
      const doc = await CatalogueItem.findById(id)
      if (!doc) throw notFound('Catalogue item not found')
      if (doc.layer !== 'organisation') throw forbidden('Only organisation catalogue items can be edited here')

      const before = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, doc.get(f)]))
      for (const field of EDITABLE_FIELDS) doc.set(field, body[field])
      doc.key = catalogueKey(body)
      doc.updatedBy = actor.userId
      doc.updatedAt = new Date()
      try {
        await doc.save()
      } catch (err) {
        throw duplicateKeyError(err, doc.key)
      }
      const after = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, doc.get(f)]))
      const changes = diffChanges({ objectType: 'CatalogueItem', objectId: doc._id, before: plain(before), after: plain(after), fields: EDITABLE_FIELDS })
      await recordAudit({
        organisationId,
        actor: userActor(actor.userId, actor.role),
        action: 'catalogue.item.updated',
        objectType: 'CatalogueItem',
        objectId: doc._id,
        changeType: 'design_intent',
        source: 'ui',
        changes,
      })
      return toItem(doc.toObject(), { showPrices: true })
    },

    // CSV import into the organisation layer. The client previews with the
    // same shared validator; it is re-run here and nothing is written unless
    // every row passes. Rows matching an existing organisation item (same
    // kind, vendor and model) update it; the rest are created. One transaction.
    async importRows({ organisationId, actor, rows }) {
      const result = validateCatalogueRows(rows)
      if (!result.ok) {
        throw badRequest('Some rows did not validate', {
          rowErrors: result.rows.filter((r) => r.errors.length).map((r) => ({ index: r.index, errors: r.errors })),
        })
      }
      const counts = await withTransaction(async (session) => {
        let created = 0
        let updated = 0
        for (const { item, key } of result.rows) {
          const existing = await CatalogueItem.findOne({ layer: 'organisation', kind: item.kind, key }).collation(KEY_COLLATION).session(session)
          if (existing) {
            for (const field of EDITABLE_FIELDS) existing.set(field, item[field])
            existing.key = key
            existing.updatedBy = actor.userId
            existing.updatedAt = new Date()
            await existing.save({ session })
            updated++
          } else {
            await CatalogueItem.create([{ ...item, key, layer: 'organisation', createdBy: actor.userId, updatedBy: actor.userId }], { session })
            created++
          }
        }
        await recordAudit({
          organisationId,
          actor: userActor(actor.userId, actor.role),
          action: 'catalogue.import.completed',
          objectType: 'Organisation',
          objectId: organisationId,
          changeType: 'import',
          source: 'import',
          comment: `${created} created, ${updated} updated`,
          session,
        })
        return { created, updated }
      })
      return counts
    },
  }
}

// Audit diffs compare plain values, not Mongoose subdocuments or Dates.
function plain(values) {
  return JSON.parse(JSON.stringify(values))
}
