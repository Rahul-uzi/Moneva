import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Last, so its media-bounded rules land after every component stylesheet and
// do not depend on import order to win.
import './styles/landscape.css'
import App from './App.tsx'
import { initTheme } from './services/themeService'
import { clearStoredApiUrl, warmUpApi } from './services/apiClient'

// Apply the saved appearance preference before first paint.
initTheme()

// If a saved API override is unreachable but the built-in one works, fall back.
// The endpoint is permanent; drop any override an older install saved.
clearStoredApiUrl()

// Nudge the server awake now rather than when somebody is waiting on it. The
// host suspends idle instances and takes ~30s to come back, which is longer
// than any request is willing to wait.
warmUpApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
