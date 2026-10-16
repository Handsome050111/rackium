import { useCallback, useEffect, useRef, useState } from 'react'
import { documentsApi } from '../../api/documentsApi.js'

// Starts a browser download of a ready document (the session cookie authorises it).
export function downloadDocument(orgId, projectId, doc) {
  const a = document.createElement('a')
  a.href = documentsApi.downloadUrl(orgId, projectId, doc.id)
  a.download = doc.fileName ?? ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Requests a document and polls it until it is ready (then downloads it) or failed.
export function useDocumentJob(orgId, projectId) {
  const [job, setJob] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const start = useCallback(
    async (body, { autoDownload = true } = {}) => {
      clearTimeout(timer.current)
      setJob({ status: 'queued', progress: 0, step: 'Queued' })
      const poll = (d) => {
        setJob(d)
        if (d.status === 'ready') {
          if (autoDownload) downloadDocument(orgId, projectId, d)
          return
        }
        if (d.status === 'failed') return
        timer.current = setTimeout(() => {
          documentsApi
            .get(orgId, projectId, d.id)
            .then((r) => poll(r.document))
            .catch((err) => setJob({ status: 'failed', error: err.message }))
        }, 1200)
      }
      try {
        poll((await documentsApi.request(orgId, projectId, body)).document)
      } catch (err) {
        setJob({ status: 'failed', error: err.message })
      }
    },
    [orgId, projectId]
  )
  return { job, start }
}
