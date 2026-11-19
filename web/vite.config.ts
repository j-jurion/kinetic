import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The FastAPI backend runs on port 8000 during development. Requests to /api are proxied so
// the browser sees a single origin (needed for the session cookie and the Origin check).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000' },
    },
  },
})
