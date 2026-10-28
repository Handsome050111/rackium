import { useEffect, useState } from 'react'
import { DEFAULT_MODE_LABELS } from '@rackium/shared/modeState.js'
import { deliveryApi } from '../api/deliveryApi.js'

const cache = new Map()

// The project's state labels (M7b-4a, DATA-MODEL §5.21): the client's words
// for current / interim / future. CMO / IMO / FMO until loaded, and in mock mode.
export function useModeLabels(orgId, projectId) {
  const key = `${orgId}/${projectId}`
  const [labels, setLabels] = useState(() => cache.get(key) ?? DEFAULT_MODE_LABELS)
  useEffect(() => {
    let live = true
    deliveryApi
      .modeLabels(orgId, projectId)
      .then((res) => {
        if (!res?.modeLabels) return
        cache.set(key, res.modeLabels)
        if (live) setLabels(res.modeLabels)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [orgId, projectId, key])
  return labels
}

// After the labels are saved: screens opened next read them afresh.
export function rememberModeLabels(orgId, projectId, labels) {
  cache.set(`${orgId}/${projectId}`, labels)
}
