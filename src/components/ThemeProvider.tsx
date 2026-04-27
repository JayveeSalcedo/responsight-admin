'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const ThemeContext = createContext<{
  theme:       Theme
  toggleTheme: () => void
}>({ theme: 'dark', toggleTheme: () => {} })

// Read synchronously so the very first render already has the right theme.
// No useEffect → no flash, no extra render cycle.
function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('rs_theme') as Theme) ?? 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)

  // Apply class on mount (handles SSR where readTheme returns 'dark')
  useEffect(() => {
    applyTheme(theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('rs_theme', next)
      applyTheme(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
