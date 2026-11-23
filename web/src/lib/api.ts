// The web app's client for the FastAPI backend (served under /api on the same origin).
import { createApiClient } from '@kinetic/shared/api'

export { ApiError, qs } from '@kinetic/shared/api'

export const api = createApiClient({
  baseUrl: '/api',
  credentials: 'same-origin',
  onUnauthorized: () => window.location.assign('/login'),
})
