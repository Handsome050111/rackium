import { ALL_ROLES, PROJECT_ROLES, ORG_ROLE, ROLE_LABELS } from '@rackium/shared/policy.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { Membership } from '../models/membership.js'

// Inviting real testers from a list (docs/DEPLOY-DEMO.md): name, email, role,
// one per line. The same invitation as the Team page, sent by the real mailer.
// The list holds personal data: it stays on the server, never in the repo.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const roleKey = (text) => {
  const t = String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ALL_ROLES.find((r) => r === t || ROLE_LABELS[r]?.toLowerCase().replace(/\s+/g, '_') === t) ?? null
}

// Comma, semicolon or tab separated; an optional header line; # starts a
// comment. A name may be quoted, or be written "Family, Given" in quotes.
function cells(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && [',', ';', '\t'].includes(ch)) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

// The list, checked whole: nothing is sent while any line is wrong.
export function parseTesterList(text) {
  const testers = []
  const problems = []
  const seen = new Set()
  String(text).replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const [name, email, role, ...rest] = cells(line)
    const at = `Line ${i + 1}`
    if (i === 0 && /^name$/i.test(name) && /mail/i.test(email ?? '')) return
    if (rest.some(Boolean)) return problems.push(`${at}: expected name, email, role`)
    if (!name) return problems.push(`${at}: no name`)
    if (!EMAIL.test(email ?? '')) return problems.push(`${at}: "${email ?? ''}" is not an email address`)
    const key = roleKey(role)
    if (!key) return problems.push(`${at}: "${role ?? ''}" is not a role (${ALL_ROLES.join(', ')})`)
    const address = email.toLowerCase()
    if (seen.has(address)) return problems.push(`${at}: ${address} is listed twice`)
    seen.add(address)
    return testers.push({ name, email: address, role: key })
  })
  return { testers, problems }
}

// Invites each tester to a project of the organisation (the Org Admin role to
// the organisation itself). Someone already there or already invited is
// reported and skipped, so the list can be run again. No token is ever
// returned: the link goes only to the tester's own address.
export async function inviteTesters({ org, organisationName, projectCode, testers, dryRun = false }) {
  const organisation = await Organisation.findOne({ name: organisationName, deletedAt: null }).lean()
  if (!organisation) throw new Error(`No organisation named "${organisationName}"`)
  const organisationId = String(organisation._id)
  return runWithScope({ organisationId }, async () => {
    const project = await Project.findOne({ code: projectCode }).lean()
    if (!project) throw new Error(`No project with the code "${projectCode}" in ${organisationName}`)
    const admin = await Membership.findOne({ level: 'organisation', role: ORG_ROLE, active: { $ne: false } }).lean()
    if (!admin) throw new Error(`${organisationName} has no Org Admin to send the invitations from`)
    const actor = { userId: admin.userId, role: ORG_ROLE }
    const results = []
    for (const tester of testers) {
      const projectLevel = PROJECT_ROLES.includes(tester.role)
      if (dryRun) {
        results.push({ ...tester, outcome: 'would_invite' })
        continue
      }
      try {
        await org.createInvitation({ organisationId, actor, body: { email: tester.email, name: tester.name, role: tester.role, scopes: [], ...(projectLevel ? { projectId: String(project._id) } : {}) } })
        results.push({ ...tester, outcome: 'invited' })
      } catch (err) {
        if (['already_member', 'invitation_pending'].includes(err.code)) results.push({ ...tester, outcome: err.code })
        else results.push({ ...tester, outcome: 'failed', reason: err.message })
      }
    }
    return results
  })
}
