import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './services/themeService'
import { clearStoredApiUrl } from './services/apiClient'

// Apply the saved appearance preference before first paint.
initTheme()

// If a saved API override is unreachable but the built-in one works, fall back.
// The endpoint is permanent; drop any override an older install saved.
clearStoredApiUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
