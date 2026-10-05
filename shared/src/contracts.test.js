import { describe, it, expect } from 'vitest'
import { signUpBody, loginBody, inviteCreateBody, membershipUpdateBody, projectCreateBody, PASSWORD_MIN } from './contracts.js'

const okPassword = 'correct horse battery'

describe('contracts', () => {
  it('normalises email to lower case and trims it on sign-up', () => {
    const parsed = signUpBody.parse({ organisationName: 'Acme', name: 'Ann', email: '  Ann@Example.COM ', password: okPassword })
    expect(parsed.email).toBe('ann@example.com')
  })

  it('rejects a password shorter than the minimum', () => {
    const result = signUpBody.safeParse({ organisationName: 'Acme', name: 'Ann', email: 'a@b.co', password: 'x'.repeat(PASSWORD_MIN - 1) })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(loginBody.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false)
  })

  it('organisation invitations are for Org Admin only and carry no scopes', () => {
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'org_admin' }).success).toBe(true)
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'pm' }).success).toBe(false)
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'org_admin', scopes: [{ type: 'building', refId: 'a'.repeat(24) }] }).success).toBe(false)
  })

  it('project invitations need a project role and a valid project id', () => {
    const projectId = 'b'.repeat(24)
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'architect', projectId }).success).toBe(true)
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'org_admin', projectId }).success).toBe(false)
    expect(inviteCreateBody.safeParse({ email: 'a@b.co', role: 'architect', projectId: 'nope' }).success).toBe(false)
  })

  it('a membership update must change something', () => {
    expect(membershipUpdateBody.safeParse({}).success).toBe(false)
    expect(membershipUpdateBody.safeParse({ role: 'viewer' }).success).toBe(true)
  })

  it('project codes are letters, digits and hyphens', () => {
    expect(projectCreateBody.safeParse({ name: 'LANspire', code: 'LAN-01' }).success).toBe(true)
    expect(projectCreateBody.safeParse({ name: 'LANspire', code: 'LAN 01' }).success).toBe(false)
  })
})
