import { useEffect, useState } from 'react'
import { API_MODE } from './apiMode.js'
import { apiRequest } from '../api/httpClient.js'

// What the server says before anyone signs in: the environment banner and
// whether sign-up is open. Asked once per page load. Null until it answers.
const MOCK = { banner: null, signupEnabled: true }
let cached = API_MODE === 'real' ? null : MOCK
let pending = null

function load() {
  pending ??= apiRequest('/client-config')
    .then((config) => {
      cached = config
      return config
    })
    // Not reachable: no banner; the sign-up page itself says if it is closed.
    .catch(() => {
      cached = { banner: null, signupEnabled: true }
      return cached
    })
  return pending
}

export function useClientConfig() {
  const [config, setConfig] = useState(cached)
  useEffect(() => {
    if (config) return undefined
    let live = true
    load().then((c) => live && setConfig(c))
    return () => {
      live = false
    }
  }, [config])
  return config
}
