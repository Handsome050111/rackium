import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { documentsApi } from '../api/documentsApi.js'

// Where a cable label's QR code lands (M6b): behind sign-in; the server
// resolves the connection only for members whose scope covers its building,
// then the app opens it in the CMDB (accepted) or in Deployment.
export default function RealConnectionLink() {
  const { orgId, projectId, connectionId } = useParams()
  const [target, setTarget] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    documentsApi
      .locate(orgId, projectId, connectionId)
      .then(setTarget)
      .catch((err) => setError(err.status === 404 ? 'This connection is not in the part of the project you can see.' : err.message))
  }, [orgId, projectId, connectionId])
  if (error) return <div className="p-6 text-sm text-status-red" role="alert">{error}</div>
  if (!target) return <div className="p-6 text-sm text-text-secondary">Opening the connection…</div>
  const base = `/orgs/${orgId}/projects/${projectId}/buildings/${target.buildingId}`
  return <Navigate replace to={target.screen === 'cmdb' ? `${base}/cmdb?tab=ports&record=${target.deviceId}` : `${base}/deployment?device=${target.deviceId}`} />
}
