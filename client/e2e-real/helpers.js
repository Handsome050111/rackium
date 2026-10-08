import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

// Shared by the real-mode specs (run against server/e2e/testServer.mjs).
const here = path.dirname(fileURLToPath(import.meta.url))
const EMAILS_FILE = path.join(here, '../../server/e2e/.runtime-emails.json')
export const PASSWORD = 'correct horse battery staple'
export const fixture = (name) => path.join(here, 'fixtures', name)

function readEmails() {
  return JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'))
}

// The route awaits mailer.send() before responding, so the file is already
// written by the time the HTTP call returns — this just adds a short,
// cheap retry in case of filesystem write-visibility lag.
export async function lastEmailTo(to, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const match = [...readEmails()].reverse().find((m) => m.to === to)
    if (match) return match
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`No email arrived for ${to}`)
}

export function tokenFrom(message) {
  const link = message.text.match(/https?:\/\/\S+/)[0]
  return new URL(link).searchParams.get('token')
}

// Signs up a new organisation, verifies the email and signs in. Returns the orgId.
export async function signUpAndSignIn(page, { email, organisationName = 'Acme Networks' }) {
  await page.goto('/signup')
  await page.getByLabel('Organisation name').fill(organisationName)
  await page.getByLabel('Your name').fill('Owner')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password (12 characters or more)').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create organisation' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  const token = tokenFrom(await lastEmailTo(email))
  await page.goto(`/verify-email?token=${token}`)
  await expect(page.getByText('Your email is confirmed.')).toBeVisible()

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/orgs\/[a-f0-9]+\/projects$/)
  return new URL(page.url()).pathname.match(/\/orgs\/([a-f0-9]+)/)[1]
}

// Runs the project wizard with a hierarchy CSV. Returns the projectId.
export async function createProjectWithHierarchy(page, orgId, { name, hierarchyCsv }) {
  await page.goto(`/orgs/${orgId}/projects`)
  await page.getByRole('link', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill(name)
  await page.getByLabel('Client name').fill('Acme Retail')
  await page.getByLabel('Wired Network Site Survey', { exact: false }).check()
  await page.getByRole('button', { name: 'Full Network Deployment' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.locator('input[type="file"]').setInputFiles(hierarchyCsv)
  await expect(page.getByText(/ready to create/)).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/projects/[a-f0-9]+$`))
  return new URL(page.url()).pathname.match(/\/projects\/([a-f0-9]+)$/)[1]
}
