import { describe, it, expect } from 'vitest'
import { createTestApp } from './helpers/app.js'
import { buildRegistry } from '../src/openapi/document.js'

// app.__apiRoutes (app.js) lists every route actually registered, derived
// from the same router wiring the app serves (http/routeRecorder.js) — not a
// hand-kept list, so it cannot itself drift. This fails the moment a mounted
// route has no matching registry.registerPath() in openapi/document.js,
// which is the only way that can happen again.
describe('OpenAPI document covers every mounted route', () => {
  it('has a registerPath for every route the app actually serves', () => {
    const { app } = createTestApp()
    const documented = new Set(
      buildRegistry()
        .definitions.filter((d) => d.type === 'route')
        .map((d) => `${d.route.method} ${d.route.path}`)
    )
    const missing = app.__apiRoutes.filter(({ method, path }) => !documented.has(`${method} ${path}`))
    expect(missing).toEqual([])
  })
})
