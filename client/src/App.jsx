import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import RealAppShell from './components/RealAppShell.jsx'
import ProjectsList from './pages/ProjectsList.jsx'
import ProjectWizard from './pages/ProjectWizard.jsx'
import ProjectHome from './pages/ProjectHome.jsx'
import ProjectSettings from './pages/ProjectSettings.jsx'
import RealBuildingDashboard from './pages/RealBuildingDashboard.jsx'
import RealPhasePlaceholder from './pages/RealPhasePlaceholder.jsx'
import RealCmo from './pages/RealCmo.jsx'
import RealSurveyLayout from './pages/realSurvey/RealSurveyLayout.jsx'
import RealSiteStructure from './pages/realSurvey/RealSiteStructure.jsx'
import RealRackSurvey from './pages/realSurvey/RealRackSurvey.jsx'
import RealRoomDetails from './pages/realSurvey/RealRoomDetails.jsx'
import RealHld from './pages/RealHld.jsx'
import RealLld from './pages/RealLld.jsx'
import RealRackiumEditor from './pages/RealRackiumEditor.jsx'
import RealBom from './pages/RealBom.jsx'
import RealDeployment from './pages/RealDeployment.jsx'
import RealCmdb from './pages/RealCmdb.jsx'
import RealHandover from './pages/RealHandover.jsx'
import RealDocumentDownload from './pages/RealDocumentDownload.jsx'
import RealConnectionLink from './pages/RealConnectionLink.jsx'
import RealSolutionPackage from './pages/RealSolutionPackage.jsx'
import RealClientApproval from './pages/RealClientApproval.jsx'
import { API_MODE } from './lib/apiMode.js'
import EnvBanner from './components/EnvBanner.jsx'
import OrganisationSettings from './pages/OrganisationSettings.jsx'
import RealTasks from './pages/RealTasks.jsx'
import RealSchedule from './pages/RealSchedule.jsx'
import RealDguv from './pages/RealDguv.jsx'
import RealProjectDashboard from './pages/RealProjectDashboard.jsx'
import RealOrgDashboard from './pages/RealOrgDashboard.jsx'
import RealWorkload from './pages/RealWorkload.jsx'
import RealAnalytics from './pages/RealAnalytics.jsx'
import RealReports from './pages/RealReports.jsx'
import AuditLog from './pages/AuditLog.jsx'
import NotificationPreferences from './pages/NotificationPreferences.jsx'
import Catalogue from './pages/Catalogue.jsx'
import CatalogueItem from './pages/CatalogueItem.jsx'
import CatalogueItemForm from './pages/CatalogueItemForm.jsx'
import Login from './pages/Login.jsx'
import SignUp from './pages/SignUp.jsx'
import VerifyEmail from './pages/VerifyEmail.jsx'
import { PasswordResetRequest, PasswordResetConfirm } from './pages/PasswordReset.jsx'
import InviteAccept from './pages/InviteAccept.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import Team from './pages/Team.jsx'

// Mock mode goes straight to the prototype's one building. Real mode goes to
// the signed-in user's projects, once memberships have loaded.
function Home() {
  const { mode, status, memberships } = useAuth()
  if (mode === 'mock') return <Navigate to="/b/b001" replace />
  if (status === 'loading') return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  if (status === 'signed_out') return <Navigate to="/login" replace />
  const orgId = memberships[0]?.organisationId
  return <Navigate to={orgId ? `/orgs/${orgId}/projects` : '/login'} replace />
}

// Real mode has no prototype screens: they live in mockRoutes.jsx, which a
// release build does not import at all (scripts/assert-release.mjs checks).
const MOCK_MODE = import.meta.env.MODE !== 'release' && API_MODE !== 'real'
let MockBuilding = null
let MockDemoGuide = null
let MockClientApproval = null
// MODE is inlined at build time: a release build drops this block, and the import with it.
if (import.meta.env.MODE !== 'release') {
  const screen = (name) => lazy(() => import('./mockRoutes.jsx').then((m) => ({ default: m[name] })))
  MockBuilding = screen('MockBuildingRoutes')
  MockDemoGuide = screen('DemoGuide')
  MockClientApproval = screen('ClientApproval')
}

export default function App() {
  return (
    <>
    <EnvBanner />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/password-reset" element={<PasswordResetRequest />} />
      <Route path="/password-reset/confirm" element={<PasswordResetConfirm />} />
      <Route path="/invite" element={<InviteAccept />} />
      <Route path="/team" element={<RequireAuth><Team /></RequireAuth>} />
      {MOCK_MODE && <Route path="/demo-guide" element={<Suspense fallback={null}><MockDemoGuide /></Suspense>} />}
      {/* The public client approval page: the real one on the backend (M5a), the prototype's in mock mode. */}
      <Route path="/approve/:token" element={MOCK_MODE ? <Suspense fallback={null}><MockClientApproval /></Suspense> : <RealClientApproval />} />
      {/* M6b: documents shared by a download link (no login), and a cable label's QR code (sign-in required). */}
      <Route path="/download/:token" element={<RealDocumentDownload />} />
      <Route path="/l/:orgId/:projectId/c/:connectionId" element={<RequireAuth><RealConnectionLink /></RequireAuth>} />
      {MOCK_MODE && <Route path="/b/:buildingId/*" element={<Suspense fallback={null}><MockBuilding /></Suspense>} />}

      <Route path="/orgs/:orgId" element={<RequireAuth><RealAppShell /></RequireAuth>}>
        <Route path="projects" element={<ProjectsList />} />
        <Route path="projects/new" element={<ProjectWizard />} />
        <Route path="projects/:projectId" element={<ProjectHome />} />
        <Route path="projects/:projectId/settings" element={<ProjectSettings />} />
        <Route path="projects/:projectId/buildings/:buildingId" element={<RealBuildingDashboard />} />
        <Route path="projects/:projectId/buildings/:buildingId/cmo" element={<RealCmo />} />
        <Route path="projects/:projectId/buildings/:buildingId/survey" element={<RealSurveyLayout />}>
          <Route index element={<RealSiteStructure key="building" mode="building" />} />
          <Route path="campus" element={<RealSiteStructure key="campus" mode="campus" />} />
          <Route path="rack" element={<RealRackSurvey />} />
          <Route path="room" element={<RealRoomDetails />} />
        </Route>
        <Route path="projects/:projectId/buildings/:buildingId/hld" element={<RealHld />} />
        <Route path="projects/:projectId/buildings/:buildingId/lld" element={<RealLld />} />
        <Route path="projects/:projectId/buildings/:buildingId/lld/editor" element={<RealRackiumEditor />} />
        <Route path="projects/:projectId/buildings/:buildingId/solution-package" element={<RealSolutionPackage />} />
        <Route path="projects/:projectId/buildings/:buildingId/bom" element={<RealBom />} />
        <Route path="projects/:projectId/buildings/:buildingId/deployment" element={<RealDeployment />} />
        <Route path="projects/:projectId/buildings/:buildingId/cmdb" element={<RealCmdb />} />
        <Route path="projects/:projectId/buildings/:buildingId/handover" element={<RealHandover />} />
        <Route path="projects/:projectId/buildings/:buildingId/:phaseKey" element={<RealPhasePlaceholder />} />
        <Route path="settings" element={<OrganisationSettings />} />
        <Route path="tasks" element={<RealTasks key="mine" />} />
        <Route path="projects/:projectId/tasks" element={<RealTasks key="project" />} />
        <Route path="projects/:projectId/schedule" element={<RealSchedule />} />
        <Route path="projects/:projectId/dguv" element={<RealDguv />} />
        <Route path="projects/:projectId/dashboard" element={<RealProjectDashboard />} />
        <Route path="projects/:projectId/workload" element={<RealWorkload />} />
        <Route path="projects/:projectId/analytics" element={<RealAnalytics />} />
        <Route path="projects/:projectId/reports" element={<RealReports />} />
        <Route path="dashboard" element={<RealOrgDashboard />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="notifications/preferences" element={<NotificationPreferences />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="catalogue/new" element={<CatalogueItemForm />} />
        <Route path="catalogue/:itemId" element={<CatalogueItem />} />
        <Route path="catalogue/:itemId/edit" element={<CatalogueItemForm key="edit" />} />
      </Route>
      {/* Real mode: an unknown address goes home rather than to a blank page. */}
      {!MOCK_MODE && <Route path="*" element={<Navigate to="/" replace />} />}
    </Routes>
    </>
  )
}
