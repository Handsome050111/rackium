import { useEffect } from 'react'
import { useClientConfig } from '../lib/useClientConfig.js'

const HEIGHT = '1.75rem'

// The environment's banner (ENV_BANNER on the server), on every screen, signed
// in or not: above everything, in the page's flow. Full-height layouts take
// its height off through --env-banner-h. No banner when the server sets none.
export default function EnvBanner() {
  const banner = useClientConfig()?.banner ?? null
  useEffect(() => {
    if (!banner) return undefined
    document.documentElement.style.setProperty('--env-banner-h', HEIGHT)
    return () => document.documentElement.style.removeProperty('--env-banner-h')
  }, [banner])
  if (!banner) return null
  return (
    <div role="note" data-testid="env-banner" title={banner} style={{ height: HEIGHT }} className="flex items-center justify-center bg-status-amber px-3 text-xs font-semibold text-black">
      <span className="truncate">{banner}</span>
    </div>
  )
}
