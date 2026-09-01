import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from './services/themeService'
import { reconcileApiBaseUrl } from './services/apiClient'

// Apply the saved appearance preference before first paint.
initTheme()

// If a saved API override is unreachable but the built-in one works, fall back.
void reconcileApiBaseUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
