import Logo from '../Logo.jsx'

export const authInput =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

export const authButton =
  'h-11 w-full rounded-lg bg-brand text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'

// Shared frame for the sign-in, sign-up, reset and invitation screens.
export default function AuthShell({ title, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-1.5">
          <Logo className="h-9" />
          <p className="text-xs text-text-secondary">Infra, Clearly Connected.</p>
        </div>
        <div className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold text-text">{title}</h1>
          {children}
        </div>
        {footer && <div className="space-y-1 text-center text-xs text-text-secondary">{footer}</div>}
      </div>
    </div>
  )
}
