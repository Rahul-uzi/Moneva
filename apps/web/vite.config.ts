import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Module ids use OS separators on Windows; normalise before matching. */
const inPackage = (...names: string[]) => (id: string) => {
  const path = id.split('\\').join('/')
  return names.some((name) => path.includes(`/node_modules/${name}/`))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Routes are lazy-loaded, so hold the entry chunk to a tight budget.
    chunkSizeWarningLimit: 350,
    rolldownOptions: {
      output: {
        // Split rarely-changing vendor code so it stays cached across app
        // updates instead of being re-downloaded with every release.
        advancedChunks: {
          groups: [
            { name: 'react-vendor', test: inPackage('react', 'react-dom', 'scheduler') },
            { name: 'router', test: inPackage('react-router', 'react-router-dom') },
            { name: 'forms', test: inPackage('react-hook-form', '@hookform/resolvers', 'zod') },
            { name: 'http', test: inPackage('axios') },
            { name: 'icons', test: inPackage('lucide-react') },
          ],
        },
      },
    },
  },
})
