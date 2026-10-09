import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ACTIONS, ROLE_LABELS } from '@rackium/shared/policy.js'
import { organisationApi } from '../api/organisationApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import NamingCodesSection from '../components/NamingCodesSection.jsx'
import { canIn } from '../lib/realRoles.js'

function Section({ title, description, children }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  )
}

// One row per person, from their organisation and project memberships.
function groupByUser(rows) {
  const people = new Map()
  for (const m of rows) {
    if (!m.user) continue
    const person = people.get(m.user.id) ?? { user: m.user, org: null, projectRoles: [] }
    if (m.level === 'organisation') person.org = m
    else person.projectRoles.push(m.role)
    people.set(m.user.id, person)
  }
  return [...people.values()].sort((a, b) => a.user.email.localeCompare(b.user.email))
}

// Organisation settings (Org Admin): who may create projects, and whether
// Architects see prices (brief v2.3 §4.3; M3a review).
export default function OrganisationSettings() {
  const { orgId } = useParams()
  const { memberships } = useAuth()
  const isOrgAdmin = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  const [members, setMembers] = useState(null)
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    Promise.all([organisationApi.members(orgId), organisationApi.settings(orgId)])
      .then(([m, s]) => {
        setMembers(m.members)
        setSettings(s.settings)
      })
      .catch((err) => setError(err.message))
  }, [orgId])

  useEffect(() => {
    if (isOrgAdmin) load()
  }, [isOrgAdmin, load])

  const people = useMemo(() => (members ? groupByUser(members) : []), [members])

  if (!isOrgAdmin) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-text-secondary">Only an Org Admin can change organisation settings.</div>
  }

  // The change shows at once; the server's answer then replaces it (and a
  // refusal puts the real state back).
  async function run(key, optimistic, fn) {
    setBusy(key)
    setError(null)
    optimistic()
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
      load()
    }
  }

  function toggleProjectCreation(userId, allowed) {
    const withFlag = (rows) => {
      const isOrgRow = (m) => m.user?.id === userId && m.level === 'organisation'
      if (rows.some(isOrgRow)) return rows.map((m) => (isOrgRow(m) ? { ...m, canCreateProjects: allowed } : m))
      // No organisation row yet: the server creates one; show it now.
      const user = rows.find((m) => m.user?.id === userId).user
      return [...rows, { level: 'organisation', role: 'member', canCreateProjects: allowed, user }]
    }
    run(
      userId,
      () => setMembers(withFlag),
      () => organisationApi.setProjectCreation(orgId, userId, allowed)
    )
  }

  function togglePricing(value) {
    run(
      'pricing',
      () => setSettings((s) => ({ ...s, architectsSeePrices: value })),
      () => organisationApi.updateSettings(orgId, { architectsSeePrices: value })
    )
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-text">Organisation settings</h1>
      {error && <p className="text-sm text-status-red">{error}</p>}

      <Section title="Pricing" description="Org Admins, PMs and Reviewers always see catalogue prices and margins.">
        {settings && (
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={settings.architectsSeePrices}
              disabled={busy === 'pricing'}
              onChange={(e) => togglePricing(e.target.checked)}
            />
            Architects can see prices
          </label>
        )}
      </Section>

      <Section title="Naming" description="Hostname role codes: {role}-{country}-{sal}-{campus}-{building}-{floor}-{seq}, e.g. E-DE-ERL-C01-B001-EG-001.">
        {settings?.namingRoleCodes && (
          <NamingCodesSection
            key={JSON.stringify(settings.namingRoleCodes)}
            settings={settings}
            onSave={async (namingRoleCodes) => {
              const res = await organisationApi.updateSettings(orgId, { namingRoleCodes })
              setSettings(res.settings)
            }}
          />
        )}
      </Section>

      <Section title="Members" description="Who may create projects. Org Admins always can; people who joined as PM can by default.">
        {!members ? (
          <p className="text-xs text-text-secondary">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-text-secondary">
                  {['Member', 'Organisation', 'Project roles', 'Can create projects'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map(({ user, org, projectRoles }) => {
                  const isAdmin = org?.role === 'org_admin'
                  return (
                    <tr key={user.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{user.name}</div>
                        <div className="text-[11px] text-text-secondary">{user.email}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{isAdmin ? 'Org Admin' : 'Member'}</td>
                      <td className="px-3 py-2 text-text-secondary">{[...new Set(projectRoles)].map((r) => ROLE_LABELS[r] ?? r).join(', ') || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {isAdmin ? (
                          <span className="text-text-secondary">Always</span>
                        ) : (
                          <label className="flex items-center gap-2 text-text">
                            <input
                              type="checkbox"
                              aria-label={`${user.email} can create projects`}
                              checked={Boolean(org?.canCreateProjects)}
                              disabled={busy === user.id}
                              onChange={(e) => toggleProjectCreation(user.id, e.target.checked)}
                            />
                            {org?.canCreateProjects ? 'Allowed' : 'Not allowed'}
                          </label>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
