import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { RoleProvider } from './lib/RoleContext.jsx'
import { OfflineProvider } from './lib/OfflineContext.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { ViewAsProvider } from './lib/ViewAsContext.jsx'
import { hydrateAll, startAutosave } from './lib/persistentStore.js'
import { API_MODE } from './lib/apiMode.js'

// hydrateAll restores every registered api/*.js store from IndexedDB before the
// first render, so every screen is consistent with the last save instead of racing it.
async function start() {
  // Mock mode: its screens and stores before the stores are restored, and the
  // mock e2e suite's hooks. A release build has none of them (MODE is inlined).
  if (import.meta.env.MODE !== 'release' && API_MODE !== 'real') {
    await import('./mockRoutes.jsx')
    await import('./e2eTestApi.js')
  }
  await hydrateAll()

  // import.meta.env.BASE_URL mirrors vite.config.js's `base` (VITE_BASE_PATH)
  // so client-side routing still resolves correctly when the build is
  // served from a subpath — see docs/DEPLOY-DEMO.md.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <RoleProvider>
          <AuthProvider>
            <ViewAsProvider>
              <OfflineProvider>
                <App />
              </OfflineProvider>
            </ViewAsProvider>
          </AuthProvider>
        </RoleProvider>
      </BrowserRouter>
    </StrictMode>,
  )

  startAutosave()
}

start()
