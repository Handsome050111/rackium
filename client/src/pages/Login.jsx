import { useNavigate } from 'react-router-dom'
import { Mail, Lock, FlaskConical } from 'lucide-react'
import Logo from '../components/Logo.jsx'

const inputClass =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

// Static placeholder (brief v2.3 §8: "email and password login with roles
// and scopes" is listed as a later build item, not this prototype's scope —
// real auth isn't implemented). This exists purely so the demo has a
// branded entry screen instead of dropping straight into the dashboard;
// "Continue to demo" skips straight to role-switching via the top bar's
// Demo controls menu.
export default function Login() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-1.5">
          <Logo className="h-9" />
          <p className="text-xs text-text-secondary">Infra, Clearly Connected.</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate('/b/b001')
          }}
          className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm"
        >
          <div className="flex items-center gap-1.5 rounded-lg bg-status-amber/10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-amber">
            <FlaskConical size={12} strokeWidth={2} />
            Demo build — sign-in is not functional yet
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">Email</span>
            <div className="relative">
              <Mail size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input type="email" placeholder="you@technonex.com" className={`${inputClass} pl-9`} />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-secondary">Password</span>
            <div className="relative">
              <Lock size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input type="password" placeholder="••••••••" className={`${inputClass} pl-9`} />
            </div>
          </label>

          <button type="submit" className="h-11 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:opacity-90">
            Continue to demo
          </button>
        </form>

        <p className="text-center text-xs text-text-secondary">
          Role, organisation and scope switching for this demo is under the user menu's "Demo controls" once you're in.
        </p>
      </div>
    </div>
  )
}
