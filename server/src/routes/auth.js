import { Router } from 'express'
import {
  signUpBody,
  verifyEmailBody,
  resendVerificationBody,
  loginBody,
  passwordResetRequestBody,
  passwordResetConfirmBody,
  inviteAcceptBody,
} from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { authLimiter } from '../http/rateLimits.js'
import { REFRESH_COOKIE, setSessionCookies, clearSessionCookies } from '../http/cookies.js'
import { membershipsForUser } from '../auth/service.js'
import { userSummary, membershipSummary } from './summaries.js'

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') ?? null })

// Sends cookies and the signed-in view of the user in one response.
async function sessionResponse(res, config, user, tokens, status = 200) {
  setSessionCookies(res, config, tokens)
  const memberships = await membershipsForUser(user._id)
  res.status(status).json({ user: userSummary(user), memberships: memberships.map(membershipSummary) })
}

export function authRoutes({ config, auth, rateLimits }) {
  const r = Router()

  r.post(
    '/signup',
    authLimiter({ ...rateLimits.signup, enabled: rateLimits.enabled }),
    validate({ body: signUpBody }),
    async (req, res) => {
      res.status(202).json(await auth.signUp(req.input.body))
    }
  )

  r.post(
    '/verify-email',
    authLimiter({ ...rateLimits.verify, enabled: rateLimits.enabled }),
    validate({ body: verifyEmailBody }),
    async (req, res) => {
      res.json(await auth.verifyEmail(req.input.body))
    }
  )

  r.post(
    '/verify-email/resend',
    authLimiter({ ...rateLimits.resend, enabled: rateLimits.enabled }),
    validate({ body: resendVerificationBody }),
    async (req, res) => {
      res.status(202).json(await auth.resendVerification(req.input.body))
    }
  )

  r.post(
    '/login',
    authLimiter({ ...rateLimits.login, enabled: rateLimits.enabled }),
    validate({ body: loginBody }),
    async (req, res) => {
      const { user, tokens } = await auth.login({ ...req.input.body, meta: meta(req) })
      await sessionResponse(res, config, user, tokens)
    }
  )

  r.post(
    '/refresh',
    authLimiter({ ...rateLimits.refresh, enabled: rateLimits.enabled }),
    async (req, res) => {
      const { user, tokens } = await auth.refresh({ refreshToken: req.cookies?.[REFRESH_COOKIE], meta: meta(req) })
      await sessionResponse(res, config, user, tokens)
    }
  )

  r.post('/logout', async (req, res) => {
    await auth.logout({ refreshToken: req.cookies?.[REFRESH_COOKIE] })
    clearSessionCookies(res, config)
    res.status(204).end()
  })

  r.post(
    '/password-reset/request',
    authLimiter({ ...rateLimits.reset, enabled: rateLimits.enabled }),
    validate({ body: passwordResetRequestBody }),
    async (req, res) => {
      res.status(202).json(await auth.requestPasswordReset(req.input.body))
    }
  )

  r.post(
    '/password-reset/confirm',
    authLimiter({ ...rateLimits.reset, enabled: rateLimits.enabled }),
    validate({ body: passwordResetConfirmBody }),
    async (req, res) => {
      await auth.confirmPasswordReset(req.input.body)
      clearSessionCookies(res, config)
      res.json({ ok: true })
    }
  )

  r.post(
    '/invitations/accept',
    authLimiter({ ...rateLimits.invite, enabled: rateLimits.enabled }),
    validate({ body: inviteAcceptBody }),
    async (req, res) => {
      const { user, tokens } = await auth.acceptInvitation({ ...req.input.body, meta: meta(req) })
      await sessionResponse(res, config, user, tokens, 201)
    }
  )


  return r
}
