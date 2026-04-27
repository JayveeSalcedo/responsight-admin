'use client'

import { Bell, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'

interface TopBarProps {
  title:     string
  subtitle?: string
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="h-16 border-b border-surface-border flex items-center justify-between px-6 sticky top-0 z-30" style={{ backgroundColor: 'var(--bg-card)', backdropFilter: 'blur(8px)' }}>
      <div>
        <h1 className="text-base font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            placeholder="Search..."
            className="bg-surface-muted border border-surface-border rounded-lg pl-9 pr-4 py-1.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors w-52"
          />
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-9 h-9 rounded-lg bg-surface-muted border border-surface-border flex items-center justify-center hover:border-brand-600/40 transition-all"
        >
          {theme === 'dark'
            ? <Sun  className="w-4 h-4 text-text-secondary" />
            : <Moon className="w-4 h-4 text-text-secondary" />
          }
        </button>

        {/* Notifications */}
        <button className="relative w-9 h-9 rounded-lg bg-surface-muted border border-surface-border flex items-center justify-center hover:border-brand-600/40 transition-colors">
          <Bell className="w-4 h-4 text-text-secondary" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-500 rounded-full" />
        </button>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-critical/10 border border-status-critical/20">
          <span className="w-1.5 h-1.5 bg-status-critical rounded-full animate-pulse-slow" />
          <span className="text-xs font-medium text-status-critical">LIVE</span>
        </div>
      </div>
    </header>
  )
}
