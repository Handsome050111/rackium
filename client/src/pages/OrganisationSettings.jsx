import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ACTIONS, ROLE_LABELS } from '@rackium/shared/policy.js'
import { organisationApi } from '../api/organisationApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import NamingCodesSection from '../components/NamingCodesSection.jsx'
import StockLengthsSection from '../components/StockLengthsSection.jsx'
import CageNutsSection from '../components/CageNutsSection.jsx'
import TimeZoneSection from '../components/TimeZoneSection.jsx'
import DguvSection from '../components/DguvSection.jsx'
import FieldHelpSection from '../components/FieldHelpSection.jsx'
import { LogoField } from '../components/documents/BrandingSettings.jsx'
import { documentsApi } from '../api/documentsApi.js'
import { canIn } from '../lib/realRoles.js'
import ModeLabelsForm from '../components/ModeLabelsForm.jsx'
import RulesPanel from '../components/validationRules/RulesPanel.jsx'
import { validationRulesApi } from '../api/validationRulesApi.js'
import { projectsApi } from '../api/projectsApi.js'

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
  // Custom validation rules (M7b-5) and the buildings a draft can be tried on.
  const [rules, setRules] = useState(null)
  const [ruleTargets, setRuleTargets] = useState([])
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

  const loadRules = useCallback(() => validationRulesApi.organisation(orgId).list().then((r) => setRules(r.rules)), [orgId])
  useEffect(() => {
    if (!isOrgAdmin) return
    loadRules().catch(() => {})
    projectsApi
      .list(orgId)
      .then((r) => setRuleTargets(r.projects.flatMap((p) => p.buildings.map((b) => ({ key: b.id, label: `${p.name} · ${b.code}`, projectId: p.id, buildingId: b.id })))))
      .catch(() => {})
  }, [isOrgAdmin, orgId, loadRules])

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

      {settings?.modeLabels && (
        <ModeLabelsForm
          title="Mode state labels"
          own={Object.fromEntries(Object.entries(settings.modeLabels).map(([s, v]) => [s, v === settings.defaultModeLabels[s] ? null : v]))}
          inherited={settings.defaultModeLabels}
          canEdit
          onSave={async (modeLabels) => {
            const res = await organisationApi.updateSettings(orgId, { modeLabels })
            setSettings(res.settings)
          }}
        />
      )}

      <Section title="Validation rules" description="Your organisation's own checks, for every project, alongside the built-in rules. A Critical rule blocks submitting an HLD or LLD. A change applies from the next validation; anything already approved stays approved.">
        {rules && <RulesPanel testId="org-rules" rules={rules} labels={settings?.modeLabels} canEdit api={validationRulesApi.organisation(orgId)} targets={ruleTargets} onPreview={(t, rule) => validationRulesApi.preview(orgId, t.projectId, { buildingId: t.buildingId, rule })} onChanged={loadRules} empty="No organisation rules yet." />}
      </Section>

      <Section title="Cable stock lengths" description="Suggested cable lengths in the LLD round up to the next stock length; longer runs need a custom length.">
        {settings?.stockLengths && (
          <StockLengthsSection
            key={JSON.stringify(settings.stockLengths)}
            settings={settings}
            onSave={async (stockLengths) => {
              const res = await organisationApi.updateSettings(orgId, { stockLengths })
              setSettings(res.settings)
            }}
          />
        )}
      </Section>

      <Section title="Logo" description="Printed on the cover of every generated document (with the client's logo, set per project).">
        {settings && <LogoField label="Organisation logo" exists={settings.hasLogo} src={documentsApi.orgLogoUrl(orgId)} canEdit onSet={(uri) => documentsApi.setOrgLogo(orgId, uri)} onRemove={() => documentsApi.removeOrgLogo(orgId)} />}
      </Section>

      <Section title="Field help" description="The ⓘ next to each survey field: what it means, what to look for, an example, common mistakes and reference photos.">
        <FieldHelpSection orgId={orgId} />
      </Section>

      <Section title="Time zone" description="Task deadlines, due soon and overdue, and the daily digest email follow this time zone (default Europe/Berlin).">
        {settings?.timeZone && (
          <TimeZoneSection
            key={`${settings.timeZone}-${settings.digestTime}`}
            settings={settings}
            onSave={async (body) => {
              const res = await organisationApi.updateSettings(orgId, body)
              setSettings(res.settings)
            }}
          />
        )}
      </Section>

      <Section title="DGUV V3 inspections" description="Mains-powered devices: Valid, Expiring soon, Expiring or Overdue from the last inspection, on the organisation's local date.">
        {settings?.dguv && (
          <DguvSection
            key={JSON.stringify(settings.dguv)}
            settings={settings}
            onSave={async (dguv) => {
              const res = await organisationApi.updateSettings(orgId, { dguv })
              setSettings(res.settings)
            }}
          />
        )}
      </Section>

      <Section title="Cage nuts" description="The BOM counts cage nuts per RU on each face a device is fixed to: its mounting face, or both faces for full-depth gear.">
        {settings?.cageNutsPerRu && (
          <CageNutsSection
            key={JSON.stringify(settings.cageNutsPerRu)}
            settings={settings}
            onSave={async (cageNutsPerRu) => {
              const res = await organisationApi.updateSettings(orgId, { cageNutsPerRu })
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
