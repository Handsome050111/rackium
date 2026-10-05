import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Settings are not built yet. Each section is listed so the page has a real
// shape; the Members section links to the Team page in real mode, where
// members and invitations are managed.
export default function Settings() {
  const { mode } = useAuth()

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold text-text">Settings</h1>

      <section aria-labelledby="settings-organisation" className="rounded-xl border border-border bg-surface p-4">
        <h2 id="settings-organisation" className="text-sm font-semibold text-text">Organisation</h2>
        <p className="mt-1 text-sm text-text-secondary">Available soon.</p>
      </section>

      <section aria-labelledby="settings-members" className="rounded-xl border border-border bg-surface p-4">
        <h2 id="settings-members" className="text-sm font-semibold text-text">Members</h2>
        {mode === 'real' ? (
          <p className="mt-1 text-sm text-text-secondary">
            Manage members and invitations on the{' '}
            <Link to="/team" className="font-medium text-brand hover:underline">
              Team page
            </Link>
            .
          </p>
        ) : (
          <p className="mt-1 text-sm text-text-secondary">Available soon.</p>
        )}
      </section>

      <section aria-labelledby="settings-project" className="rounded-xl border border-border bg-surface p-4">
        <h2 id="settings-project" className="text-sm font-semibold text-text">Project settings</h2>
        <p className="mt-1 text-sm text-text-secondary">Available soon.</p>
      </section>
    </div>
  )
}
