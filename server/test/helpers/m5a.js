import { REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'

export const spView = async (agent, p, buildingId = p.b001) => (await agent.get(`${p.base}/solution-package/buildings/${buildingId}`).expect(200)).body
export const bomView = async (agent, p, buildingId = p.b001) => (await agent.get(`${p.base}/bom/buildings/${buildingId}`).expect(200)).body

export const ADDRESSING = [{ id: 'a1', label: 'Users', vlanId: 10, cidr: '10.10.0.0/24', gateway: '10.10.0.1' }]

// Every Required Input group filled (Architect), every remaining warning
// area accepted (PM): the package is ready for the client.
export async function readyPackage(p) {
  for (const g of REQUIRED_INPUT_GROUPS) {
    const { revision } = await spView(p.architect, p)
    const body = g.key === 'addressing' ? { addressingEntries: ADDRESSING } : { kvPairs: [{ id: 'k1', key: `${g.name} owner`, value: 'Client IT' }] }
    const res = await p.architect.put(`${p.base}/solution-package/groups/${g.key}`).send({ buildingId: p.b001, ...body, baseRevision: revision })
    if (res.status !== 200) throw new Error(`group ${g.key}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  let view = await spView(p.admin.agent, p)
  for (const area of view.validationAreas.filter((a) => a.result === 'warning')) {
    const res = await p.admin.agent.post(`${p.base}/solution-package/accept-warning`).send({ buildingId: p.b001, areaKey: area.key, baseRevision: view.revision })
    if (res.status !== 200) throw new Error(`accept ${area.key}: ${res.status} ${JSON.stringify(res.body)}`)
    view = await spView(p.admin.agent, p)
  }
  return view
}

// The PM sends the package to the client: { token, password, id, ... }.
export async function submitPackage(p, body = {}) {
  const res = await p.admin.agent.post(`${p.base}/solution-package/submit`).send({ buildingId: p.b001, ...body })
  if (res.status !== 201) throw new Error(`submit: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.shareLink
}

export const decision = (overrides = {}) => ({ decision: 'approved', name: 'Clara Client', role: 'IT Director', comments: '', termsAccepted: true, ...overrides })

// A 1×1 PNG (a drawn signature stand-in).
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// Client approval through the public API.
export function clientDecides(ctx, link, overrides = {}) {
  return ctx.agent().post(`/api/v1/public/share-links/${link.token}/decision`).send({ password: link.password, ...decision(overrides) })
}
