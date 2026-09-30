import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import BuildingOverview from './pages/BuildingOverview.jsx'
import LldLanding from './pages/LldLanding.jsx'
import RackiumEditor from './pages/RackiumEditor.jsx'
import SiteStructure from './pages/SiteStructure.jsx'
import SurveyRackLayout from './pages/SurveyRackLayout.jsx'
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
      <Route path="/b/:buildingId" element={<AppShell />}>
        <Route index element={<BuildingOverview />} />
        <Route path="lld" element={<LldLanding />} />
        <Route path="lld/editor" element={<RackiumEditor />} />
        <Route path="survey" element={<SiteStructure mode="building" />} />
        <Route path="survey/campus" element={<SiteStructure mode="campus" />} />
        <Route path="survey/rack" element={<SurveyRackLayout />} />
        <Route path=":phaseId" element={<PhasePlaceholder />} />
      </Route>
    </Routes>
  )
}
