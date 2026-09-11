import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
// Last, so its media-bounded rules land after every component stylesheet and
// do not depend on import order to win.
import './styles/landscape.css'
import App from './App.tsx'
import { initTheme } from './services/themeService'
import { clearStoredApiUrl, warmUpApi } from './services/apiClient'

/**
 * Mark the packaged app, so the stylesheet can behave like an app.
 *
 * Set before first paint and only when actually running inside the native
 * shell - the same bundle is served as a web app, where pinch-zoom is a real
 * accessibility affordance and must not be taken away.
 *
 * This is the second of two independent layers that stop the interface being
 * scaled: MainActivity turns zoom off on the WebView itself, and the CSS this
 * unlocks stops the gesture in the engine. Two, because the WebView settings
 * depend on the bridge having built its view by the time onCreate runs - if
 * that ever changes, the failure is silent, and a user left staring at a
 * half-scaled interface has no idea what they did or how to undo it.
 */
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('is-native-app')
}

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
