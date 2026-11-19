import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'

const STORAGE_KEY = 'kinetic-dark-mode'

interface DarkMode {
  dark: boolean
  toggle: () => void
}

const DarkModeContext = createContext<DarkMode>({ dark: false, toggle: () => {} })

export const useDarkMode = () => useContext(DarkModeContext)

function initialDark(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === '1'
  } catch {
    // storage unavailable: fall back to the system preference
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(initialDark)

  useEffect(() => {
    document.body.classList.toggle('body--dark', dark)
  }, [dark])

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          primary: { main: '#f97316', contrastText: '#ffffff' },
          secondary: { main: '#3b82f6' },
          error: { main: '#c10015' },
          success: { main: '#21ba45' },
          background: dark
            ? { default: '#121212', paper: '#1d1d1d' }
            : { default: '#ffffff', paper: '#ffffff' },
        },
        typography: {
          fontFamily: "'Inter', 'Roboto', sans-serif",
          fontSize: 14,
          button: { fontWeight: 500 },
        },
        shape: { borderRadius: 8 },
        components: {
          MuiButton: { defaultProps: { disableElevation: false } },
          MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
          MuiDialog: { styleOverrides: { paper: { borderRadius: 12 } } },
          MuiTextField: { defaultProps: { variant: 'standard' } },
        },
      }),
    [dark],
  )

  const value = useMemo(
    () => ({
      dark,
      toggle: () =>
        setDark((current) => {
          try {
            localStorage.setItem(STORAGE_KEY, current ? '0' : '1')
          } catch {
            // ignore: the choice just won't be remembered
          }
          return !current
        }),
    }),
    [dark],
  )

  return (
    <DarkModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </DarkModeContext.Provider>
  )
}
