import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type Severity = 'success' | 'error' | 'warning' | 'info'
type NotifyFn = (message: string, severity?: Severity, timeout?: number) => void

const NotifyContext = createContext<NotifyFn>(() => {})

/** Toast notifications, like the web app's. */
export const useNotify = () => useContext(NotifyContext)

// Dark enough for white text (at least 4.5:1)
const COLORS: Record<Severity, string> = { success: '#15803d', error: '#c10015', warning: '#b45309', info: '#374151' }

interface Toast {
  key: number
  message: string
  severity: Severity
  timeout: number
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState<Toast | null>(null)
  const notify = useCallback<NotifyFn>((message, severity = 'info', timeout = 4000) => {
    setToast({ key: Date.now(), message, severity, timeout })
    // Screen readers do not notice a toast appearing: read it out
    AccessibilityInfo.announceForAccessibility(severity === 'error' ? `Error: ${message}` : message)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.timeout)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 70 }]}>
          <View style={[styles.toast, { backgroundColor: COLORS[toast.severity] }]} accessibilityLiveRegion="polite">
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </View>
      )}
    </NotifyContext.Provider>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 480, elevation: 4, shadowOpacity: 0.2, shadowRadius: 8 },
  text: { color: '#ffffff', fontSize: 14 },
})
