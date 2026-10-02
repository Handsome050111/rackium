import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Map } from 'lucide-react'

const DEMO_BUILDING = 'b001'

const STEPS = [
  {
    title: 'Dashboard',
    path: `/b/${DEMO_BUILDING}`,
    role: 'PM',
    note: 'Overall progress, the nine phase cards and the project continuity timeline for one building.',
  },
  {
    title: 'Survey — Site Structure',
    path: `/b/${DEMO_BUILDING}/survey`,
    role: 'Field Engineer',
    note: 'Rooms, racks and inter-building connections. Try adding a room or rack from the library.',
  },
  {
    title: 'Survey — Rack Survey',
    path: `/b/${DEMO_BUILDING}/survey/rack`,
    role: 'Field Engineer',
    note: 'Open a rack from Site Structure to place devices and patch panels and capture a real rack elevation.',
  },
  {
    title: 'Survey — Room Details (forms)',
    path: `/b/${DEMO_BUILDING}/survey/room`,
    role: 'Field Engineer, then Architect',
    note: 'Fill a tab as Field Engineer and submit it, then switch to Architect to verify or reject it.',
  },
  {
    title: 'HLD',
    path: `/b/${DEMO_BUILDING}/hld`,
    role: 'Architect',
    note: 'Generate the High-Level Design from the survey and add or edit devices and uplinks.',
  },
  {
    title: 'LLD + Rackium Editor',
    path: `/b/${DEMO_BUILDING}/lld`,
    role: 'Architect',
    note: 'Port/cable schedules and rack elevations; open the Rackium Editor from a rack row to map ports directly.',
  },
  {
    title: 'BOM',
    path: `/b/${DEMO_BUILDING}/bom`,
    role: 'PM',
    note: 'Live bill of materials generated from HLD/LLD. Procurement fields unlock after Solution Package approval.',
  },
  {
    title: 'Solution Package',
    path: `/b/${DEMO_BUILDING}/solution-package`,
    role: 'Architect, then PM',
    note: 'Fill the Required Inputs register, check Validation & Approval Readiness, then generate a client share link.',
  },
  {
    title: 'Client approval link',
    path: null,
    role: 'No login — this is the public page',
    note: 'Open the share link generated in Solution Package (or paste it into a new tab) to approve, request changes or reject as the client.',
  },
  {
    title: 'Deployment & Installation',
    path: `/b/${DEMO_BUILDING}/deployment`,
    role: 'Field Engineer',
    note: 'Confirm installation and uplinking for devices; deviations from the design are logged as exceptions automatically.',
  },
  {
    title: 'CMDB',
    path: `/b/${DEMO_BUILDING}/cmdb`,
    role: 'Architect or PM',
    note: 'The as-built record, built from deployment state. Try an operational change and watch it land in the audit log.',
  },
  {
    title: 'Handover',
    path: `/b/${DEMO_BUILDING}/handover`,
    role: 'PM',
    note: 'Compile, mark reviewed, send to the client, then use the share link to accept as the client and freeze the baseline.',
  },
]

export default function DemoGuide() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Link to={`/b/${DEMO_BUILDING}`} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text">
        <ArrowLeft size={15} strokeWidth={2} />
        Back to dashboard
      </Link>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Map size={20} strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text">Demo guide</h1>
          <p className="text-sm text-text-secondary">
            A recommended click-through of the whole lifecycle for building B001, with which role to select (top-right user menu → Demo controls) at each step.
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-text-secondary">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-text">{step.title}</span>
              </div>
              {step.path && (
                <Link
                  to={step.path}
                  className="flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-brand hover:border-brand"
                >
                  Open
                  <ArrowRight size={12} strokeWidth={2} />
                </Link>
              )}
            </div>
            <div className="mt-2 pl-8">
              <span className="inline-block rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                {step.role}
              </span>
              <p className="mt-1.5 text-xs text-text-secondary">{step.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
