import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

// The FastAPI backend runs on port 8000 during development (KINETIC_API_URL overrides it).
// Requests to /api are proxied so the browser sees a single origin (needed for the session
// cookie and the Origin check).

// Code shared with the mobile app lives in packages/shared and is imported as @kinetic/shared/….
const shared = fileURLToPath(new URL('../packages/shared/src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@kinetic/shared': shared },
  },
  server: {
    // Allow the dev server to serve the shared files outside web/
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), shared] },
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.KINETIC_API_URL ?? 'http://127.0.0.1:8000' },
    },
  },
})
