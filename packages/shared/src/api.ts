// Fetch wrapper for the FastAPI backend, shared by the web and mobile apps. Each app creates
// its own client: the web app talks to /api on its own origin, the mobile app to a full URL.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ApiClientOptions {
  /** Prefix for every path, e.g. '/api' (web) or 'https://kinetic.example.com/api' (mobile). */
  baseUrl: string
  /** fetch credentials mode: 'same-origin' in the browser, 'include' on mobile. */
  credentials?: RequestCredentials
  /** Headers sent with every request, e.g. the Origin header on mobile. */
  headers?: Record<string, string>
  /** Called on a 401 outside /auth/, e.g. to show the login screen. */
  onUnauthorized?: () => void
}

export type ApiClient = ReturnType<typeof createApiClient>

export function createApiClient({ baseUrl, credentials = 'same-origin', headers = {}, onUnauthorized }: ApiClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, credentials, headers: { ...headers } }
    if (body instanceof FormData) {
      init.body = body
    } else if (body !== undefined) {
      init.headers = { ...headers, 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    const response = await fetch(`${baseUrl}${path}`, init)
    if (response.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized?.()
      throw new ApiError(401, 'Authentication required')
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`
      throw new ApiError(response.status, detail)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    delete: <T = void>(path: string) => request<T>('DELETE', path),
    upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  }
}

/** Query string from the non-empty values, e.g. qs({sport: 'running', year: null}). */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
