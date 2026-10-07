// The active View As session (or null), outside React so httpClient.js can
// read it synchronously on every request without importing React. The
// ViewAsContext (lib/ViewAsContext.jsx) wraps this for components that need
// to re-render when it changes (the banner, disabled write controls).
let current = null // { id, projectId, viewedRole } | null
const listeners = new Set()

export function getViewAsSession() {
  return current
}

export function setViewAsSession(session) {
  current = session
  for (const listener of listeners) listener(current)
}

export function subscribeViewAsSession(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
