import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

// The demo identity used in mock mode. Matches the name the prototype already
// shows in the top bar, so mock mode looks exactly as before.
export const DEMO_USER = { id: 'demo-user', email: 'demo@rackium.local', name: 'Khaista Rehman', emailVerified: true }

const ACCEPTED = { message: 'If that request can be completed, we have sent an email with the next step.' }
const real = API_MODE === 'real'

export const authApi = {
  me: () => (real ? apiRequest('/me') : Promise.resolve({ user: DEMO_USER, memberships: [] })),
  signUp: (body) => (real ? apiRequest('/auth/signup', { method: 'POST', body }) : Promise.resolve(ACCEPTED)),
  login: (body) => (real ? apiRequest('/auth/login', { method: 'POST', body }) : Promise.resolve({ user: DEMO_USER, memberships: [] })),
  logout: () => (real ? apiRequest('/auth/logout', { method: 'POST' }) : Promise.resolve(null)),
  verifyEmail: (token) => (real ? apiRequest('/auth/verify-email', { method: 'POST', body: { token } }) : Promise.resolve({ ok: true })),
  requestPasswordReset: (email) => (real ? apiRequest('/auth/password-reset/request', { method: 'POST', body: { email } }) : Promise.resolve(ACCEPTED)),
  confirmPasswordReset: (token, password) => (real ? apiRequest('/auth/password-reset/confirm', { method: 'POST', body: { token, password } }) : Promise.resolve({ ok: true })),
  resendVerification: (email) => (real ? apiRequest('/auth/verify-email/resend', { method: 'POST', body: { email } }) : Promise.resolve(ACCEPTED)),
  listInvitations: (orgId) => (real ? apiRequest(`/orgs/${orgId}/invitations`) : Promise.resolve({ invitations: [] })),
  resendInvitation: (orgId, invitationId) =>
    real ? apiRequest(`/orgs/${orgId}/invitations/${invitationId}/resend`, { method: 'POST' }) : Promise.resolve({ invitation: { id: invitationId } }),
  acceptInvitation: (body) => (real ? apiRequest('/auth/invitations/accept', { method: 'POST', body }) : Promise.resolve({ user: DEMO_USER, memberships: [] })),
}
