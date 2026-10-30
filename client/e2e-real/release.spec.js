import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'

// The release build, as a server runs it (docs/DEPLOY-DEMO.md): this project's
// client is `vite build --mode release`, served under Nginx's own security
// headers. Real mode only, no prototype screens or demo controls; the
// environment's banner on every screen; icons as the brief says. Every width,
// no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const RUN_ID = Date.now()
const BANNER = 'Test environment — do not enter real customer data'
let page
let orgId
let projectId
const errors = []

async function everyWidth(label, check = async () => {}) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    await check(width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M7B_SHOTS) await page.screenshot({ path: `${process.env.M7B_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (err) => errors.push(err.message))
})
test.afterAll(async () => {
  await page?.context().close()
})

test('the banner is on the sign-in page, under the production security headers', async () => {
  const res = await page.goto('/login')
  const csp = res.headers()['content-security-policy']
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(res.headers()['x-frame-options']).toBe('DENY')
  await expect(page.getByTestId('env-banner')).toHaveText(BANNER)
  await expect(page.getByTestId('env-banner')).toHaveRole('note') // always there: not a live region announcing news
  // The one warning every tester must read: WCAG AA contrast, measured.
  const contrast = await page.getByTestId('env-banner').evaluate((el) => {
    const style = getComputedStyle(el)
    const luminance = (css) => {
      const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map((n) => {
        const c = Number(n) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
  await everyWidth('release-login', async () => expect(page.getByTestId('env-banner')).toBeVisible())
})

test('sign-up closed on the server: no link on the sign-in page, the sign-up page says so', async ({ browser }) => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.route('**/api/v1/client-config', (route) => route.fulfill({ json: { banner: null, signupEnabled: false } }))
  await p.goto('/login')
  await expect(p.getByRole('button', { name: /Sign in/ })).toBeVisible()
  await expect(p.getByRole('link', { name: 'Create an organisation' })).toHaveCount(0)
  await expect(p.getByTestId('env-banner')).toHaveCount(0)
  await p.goto('/signup')
  await expect(p.getByRole('heading', { name: 'Sign-up is closed' })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Create organisation' })).toHaveCount(0)
  await ctx.close()
})

test('signed in: no prototype screens, test hooks or demo controls; the banner stays; the shell fits the window — every width', async () => {
  orgId = await signUpAndSignIn(page, { email: `release-${RUN_ID}@example.com`, organisationName: 'Release Org' })
  projectId = await createProjectWithHierarchy(page, orgId, { name: 'Release Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  await expect(page.getByTestId('env-banner')).toHaveText(BANNER)
  expect(await page.evaluate(() => window.__rackiumTestApi)).toBeUndefined()
  // The prototype's addresses go home, to this user's projects.
  for (const address of ['/b/b001', '/b/b001/hld', '/demo-guide', '/no/such/page']) {
    await page.goto(address)
    await expect(page, address).toHaveURL(new RegExp(`/orgs/${orgId}/projects`))
  }
  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  // The user menu: no demo controls.
  await page.getByRole('button', { name: 'User menu' }).click()
  const menu = page.getByRole('button', { name: 'Sign out' }).locator('..')
  await expect(menu).toContainText('Team')
  for (const text of ['Demo controls', 'Demo guide', 'Reset demo data', 'Simulate offline', 'View as role']) await expect(menu, text).not.toContainText(text)
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 300)
  await everyWidth('release-project', async () => {
    await expect(page.getByTestId('env-banner')).toBeVisible()
    // Banner and shell share the window: the page itself does not scroll.
    const excess = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(excess).toBeLessThanOrEqual(0)
  })
})

test('icons: Rackium blue with a 1.65 stroke; a status icon and an icon on a filled button keep their own colour', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  await expect(page.getByTestId('env-banner')).toBeVisible()
  const looks = await page.evaluate(() => {
    const out = []
    for (const svg of document.querySelectorAll('svg.lucide')) {
      const s = getComputedStyle(svg)
      out.push({ color: s.color, stroke: s.strokeWidth, cap: s.strokeLinecap, cls: svg.getAttribute('class'), onFilled: Boolean(svg.closest('.bg-brand, .text-white')), status: Boolean(svg.closest('[class*="text-status-"]')) })
    }
    return out
  })
  expect(looks.length).toBeGreaterThan(5)
  for (const icon of looks) {
    expect(icon.stroke, icon.cls).toBe('1.65px')
    expect(icon.cap, icon.cls).toBe('round')
    if (!icon.onFilled && !icon.status) expect(icon.color, icon.cls).toBe('rgb(9, 79, 154)')
  }
  // The exceptions, through the same stylesheet.
  const exceptions = await page.evaluate(() => {
    const host = document.createElement('div')
    host.innerHTML = '<div class="text-status-red"><svg class="lucide" id="a"></svg></div><svg class="lucide text-status-green" id="b"></svg><button class="bg-brand text-white"><svg class="lucide" id="c"></svg></button><svg class="lucide" style="color: rgb(1, 2, 3)" id="d"></svg><svg class="lucide text-text-secondary" id="e"></svg>'
    document.body.append(host)
    const color = (id) => getComputedStyle(document.getElementById(id)).color
    const result = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, color(id)]))
    host.remove()
    return result
  })
  expect(exceptions.a).not.toBe('rgb(9, 79, 154)')
  expect(exceptions.b).not.toBe('rgb(9, 79, 154)')
  expect(exceptions.c).toBe('rgb(255, 255, 255)')
  expect(exceptions.d).toBe('rgb(1, 2, 3)')
  expect(exceptions.e).toBe('rgb(9, 79, 154)')
  expect(errors).toEqual([])
})
