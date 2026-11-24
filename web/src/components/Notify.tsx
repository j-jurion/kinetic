import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Snackbar } from '@mui/material'

type Severity = 'success' | 'error' | 'warning' | 'info'
/** `timeout` is in ms; null keeps the toast until it is closed (for results you must not miss). */
type NotifyFn = (message: string, severity?: Severity, timeout?: number | null) => void

const NotifyContext = createContext<NotifyFn>(() => {})

/** Toast notifications, like NiceGUI's ui.notify. */
export const useNotify = () => useContext(NotifyContext)

interface Toast {
  key: number
  message: string
  severity: Severity
  timeout: number | null
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const notify = useCallback<NotifyFn>((message, severity = 'info', timeout = 5000) => {
    setToast({ key: Date.now(), message, severity, timeout })
  }, [])

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={toast?.key}
        open={!!toast}
        autoHideDuration={toast?.timeout}
        onClose={(_, reason) => reason !== 'clickaway' && setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast?.severity ?? 'info'}
          variant="filled"
          onClose={() => setToast(null)}
          sx={{ minWidth: 280 }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  )
}
