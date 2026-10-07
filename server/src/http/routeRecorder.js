import { Router } from 'express'

const METHODS = ['get', 'post', 'patch', 'put', 'delete']

// A Router that also records every route registered through it, as
// `router.__routes = [{ method, path }]` (path relative to this router's own
// mount point, in Express's `:param` form). Used so the OpenAPI drift check
// (test/api.openapi-coverage.test.js) is built from the exact same
// registrations the real app makes — it reads what actually got registered,
// so it cannot itself go stale the way a hand-maintained list would.
export function recordingRouter(options) {
  const router = Router(options)
  router.__routes = []
  for (const method of METHODS) {
    const original = router[method].bind(router)
    router[method] = (path, ...handlers) => {
      router.__routes.push({ method, path })
      return original(path, ...handlers)
    }
  }
  return router
}

// Joins a mount prefix and a route's own relative path into one full path,
// normalising Express's `:param` segments to OpenAPI's `{param}` form.
export function joinRoutePath(prefix, relative) {
  const toOpenApi = (segment) => segment.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
  const normalisedPrefix = toOpenApi(prefix).replace(/\/$/, '')
  const normalisedRelative = relative === '/' ? '' : toOpenApi(relative)
  return `${normalisedPrefix}${normalisedRelative}` || '/'
}
