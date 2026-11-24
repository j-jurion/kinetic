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
    document.documentElement.classList.toggle('dark', dark)
    document.body.classList.toggle('body--dark', dark)
  }, [dark])

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          // Light mode uses a darker orange: #f97316 as text on white is only 2.8:1 (WCAG asks 4.5)
          primary: { main: dark ? '#f97316' : '#b93d0a', contrastText: '#ffffff' },
          secondary: { main: '#3b82f6' },
          error: { main: dark ? '#f87171' : '#c10015' },
          success: { main: '#16a34a' },
          background: dark
            ? { default: '#0f1115', paper: '#171a21' }
            : { default: '#f5f6f8', paper: '#ffffff' },
        },
        typography: {
          fontFamily: "'Inter', 'Roboto', sans-serif",
          fontSize: 14,
          button: { fontWeight: 600, textTransform: 'none' },
        },
        shape: { borderRadius: 10 },
        components: {
          MuiButton: {
            defaultProps: { disableElevation: true },
            styleOverrides: {
              root: { borderRadius: 10 },
              // Dark enough for white text (at least 5:1 across the gradient)
              containedPrimary: {
                backgroundImage: 'linear-gradient(135deg, #c2410c, #9a3412)',
                boxShadow: '0 4px 12px rgba(194, 65, 12, .25)',
                '&:hover': { boxShadow: '0 6px 16px rgba(194, 65, 12, .32)' },
              },
            },
          },
          MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
          MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
          MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
          MuiMenu: { styleOverrides: { paper: { borderRadius: 12 } } },
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
