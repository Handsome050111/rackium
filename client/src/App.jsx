import { Routes, Route, Navigate, Link } from 'react-router-dom'
import { useAuth } from './lib/AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import RealAppShell from './components/RealAppShell.jsx'
import ProjectsList from './pages/ProjectsList.jsx'
import ProjectWizard from './pages/ProjectWizard.jsx'
import ProjectHome from './pages/ProjectHome.jsx'
import ProjectSettings from './pages/ProjectSettings.jsx'
import RealBuildingDashboard from './pages/RealBuildingDashboard.jsx'
import RealPhasePlaceholder from './pages/RealPhasePlaceholder.jsx'
import BuildingOverview from './pages/BuildingOverview.jsx'
import Lld from './pages/Lld.jsx'
import RackiumEditor from './pages/RackiumEditor.jsx'
import SiteStructure from './pages/SiteStructure.jsx'
import SurveyRackLayout from './pages/SurveyRackLayout.jsx'
import RoomDetails from './pages/RoomDetails.jsx'
import Hld from './pages/Hld.jsx'
import Bom from './pages/Bom.jsx'
import SolutionPackage from './pages/SolutionPackage.jsx'
import ClientApproval from './pages/ClientApproval.jsx'
import Login from './pages/Login.jsx'
import DemoGuide from './pages/DemoGuide.jsx'
import SignUp from './pages/SignUp.jsx'
import VerifyEmail from './pages/VerifyEmail.jsx'
import { PasswordResetRequest, PasswordResetConfirm } from './pages/PasswordReset.jsx'
import InviteAccept from './pages/InviteAccept.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import Team from './pages/Team.jsx'
import Settings from './pages/Settings.jsx'
import Activity from './pages/Activity.jsx'
import Deployment from './pages/Deployment.jsx'
import Cmdb from './pages/Cmdb.jsx'
import Cmo from './pages/Cmo.jsx'
import Handover from './pages/Handover.jsx'

// Shown for any /b/:buildingId/:segment that is not a known screen.
function PageNotFound() {
  return (
    <div className="p-6">
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-base font-semibold text-text">Page not found</h1>
        <p className="mt-2 text-sm text-text-secondary">This page does not exist in the prototype.</p>
        <Link to="/b/b001" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          Back to the building overview
        </Link>
      </div>
    </div>
  )
}

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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/password-reset" element={<PasswordResetRequest />} />
      <Route path="/password-reset/confirm" element={<PasswordResetConfirm />} />
      <Route path="/invite" element={<InviteAccept />} />
      <Route path="/team" element={<RequireAuth><Team /></RequireAuth>} />
      <Route path="/demo-guide" element={<DemoGuide />} />
      <Route path="/approve/:token" element={<ClientApproval />} />
      <Route path="/b/:buildingId" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<BuildingOverview />} />
        <Route path="cmo" element={<Cmo />} />
        <Route path="lld" element={<Lld />} />
        <Route path="lld/editor" element={<RackiumEditor />} />
        <Route path="survey" element={<SiteStructure mode="building" />} />
        <Route path="survey/campus" element={<SiteStructure mode="campus" />} />
        <Route path="survey/rack" element={<SurveyRackLayout />} />
        <Route path="survey/room" element={<RoomDetails />} />
        <Route path="hld" element={<Hld />} />
        <Route path="bom" element={<Bom />} />
        <Route path="solution-package" element={<SolutionPackage />} />
        <Route path="deployment" element={<Deployment />} />
        <Route path="cmdb" element={<Cmdb />} />
        <Route path="handover" element={<Handover />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<PageNotFound />} />
      </Route>

      <Route path="/orgs/:orgId" element={<RequireAuth><RealAppShell /></RequireAuth>}>
        <Route path="projects" element={<ProjectsList />} />
        <Route path="projects/new" element={<ProjectWizard />} />
        <Route path="projects/:projectId" element={<ProjectHome />} />
        <Route path="projects/:projectId/settings" element={<ProjectSettings />} />
        <Route path="projects/:projectId/buildings/:buildingId" element={<RealBuildingDashboard />} />
        <Route path="projects/:projectId/buildings/:buildingId/:phaseKey" element={<RealPhasePlaceholder />} />
      </Route>
    </Routes>
  )
}
