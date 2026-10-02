import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { RoleProvider } from './lib/RoleContext.jsx'
import { OfflineProvider } from './lib/OfflineContext.jsx'
import './e2eTestApi.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <OfflineProvider>
          <App />
        </OfflineProvider>
      </RoleProvider>
    </BrowserRouter>
  </StrictMode>,
)
