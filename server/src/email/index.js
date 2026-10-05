import { Resend } from 'resend'

// One interface, two providers. The console provider writes the message to the
// log (development only); the Resend provider sends real mail. The config
// refuses EMAIL_PROVIDER=console in production.
export function createEmailSender({ provider, from, apiKey, logger }) {
  if (provider === 'resend') {
    const client = new Resend(apiKey)
    return {
      async send({ to, subject, text, html }) {
        const { error } = await client.emails.send({ from, to, subject, text, html })
        if (error) throw new Error(`Email send failed: ${error.message ?? error.name ?? 'unknown error'}`)
      },
    }
  }
  return {
    async send({ to, subject, text }) {
      logger.info({ to, subject }, 'email (console provider): message follows')
      logger.info({ text }, 'email body (console provider, development only)')
    },
  }
}

// Test double: keeps every message in memory so tests can read the tokens.
export function createMemoryEmailSender() {
  const sent = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
    lastTo(to) {
      return [...sent].reverse().find((m) => m.to === to)
    },
  }
}
