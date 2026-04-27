'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const prevPath = useRef(pathname)
  const [loading,   setLoading]   = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-collapsed') === 'true'
    }
    return false
  })
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname
      clearTimeout(timerRef.current)
      setLoading(false)
    }
  }, [pathname])

  function handleNavigate() {
    timerRef.current = setTimeout(() => setLoading(true), 120)
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar onNavigate={handleNavigate} onCollapse={setCollapsed} />
      <div
        className="flex-1 flex flex-col relative transition-all duration-200 overflow-hidden min-w-0"
        style={{ marginLeft: collapsed ? 60 : 240 }}
      >
        {loading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/50 backdrop-blur-[2px] pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <span className="w-8 h-8 rounded-full border-[3px] border-surface-muted border-t-brand-400 animate-spin" />
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
