import { AsyncLocalStorage } from 'node:async_hooks'

// The tenant scope for the current request, carried through async work so the
// plugin can read it at query time without every call site passing it.
const storage = new AsyncLocalStorage()

// The callback is awaited inside the scope. Mongoose queries are lazy: their
// hooks run when the query is awaited, so returning a query un-awaited would
// run its hooks outside the scope.
export function runWithScope(scope, fn) {
  return storage.run(Object.freeze({ ...scope }), async () => await fn())
}

export function currentScope() {
  return storage.getStore() ?? null
}
