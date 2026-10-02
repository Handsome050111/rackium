import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
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
import Deployment from './pages/Deployment.jsx'
import Cmdb from './pages/Cmdb.jsx'
import Cmo from './pages/Cmo.jsx'
import Handover from './pages/Handover.jsx'
import { PHASES } from './mock/phases.js'

function PhasePlaceholder() {
  const { phaseId } = useParams()
  const phase = PHASES.find((p) => p.id === phaseId)
  return (
    <div className="p-6">
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-text-secondary">
        <p className="text-sm">
          <span className="font-semibold text-text">{phase?.name ?? phaseId}</span> screen is built in a later step.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/b/b001" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/demo-guide" element={<DemoGuide />} />
      <Route path="/approve/:token" element={<ClientApproval />} />
      <Route path="/b/:buildingId" element={<AppShell />}>
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
        <Route path=":phaseId" element={<PhasePlaceholder />} />
      </Route>
    </Routes>
  )
}
