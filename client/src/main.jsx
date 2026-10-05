import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { RoleProvider } from './lib/RoleContext.jsx'
import { OfflineProvider } from './lib/OfflineContext.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { hydrateAll, startAutosave } from './lib/persistentStore.js'
import './e2eTestApi.js'

// Importing App.jsx above has already pulled in and registered every
// api/*.js mock store (ES module imports are resolved eagerly) — hydrateAll
// restores all of them from IndexedDB before the first render, so every
// screen is consistent with the last save instead of racing it.
async function start() {
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
            <OfflineProvider>
              <App />
            </OfflineProvider>
          </AuthProvider>
        </RoleProvider>
      </BrowserRouter>
    </StrictMode>,
  )

  startAutosave()
}

start()
