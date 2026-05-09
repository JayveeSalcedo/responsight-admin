'use client'

import { Bell, Search, Sun, Moon, X, Flame, Waves, Car, Stethoscope, ShieldAlert, HelpCircle, MapPin, Clock, CheckCheck } from 'lucide-react'
import { useTheme } from '@/components/ThemeProvider'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { timeAgo } from '@/lib/utils'

interface TopBarProps {
  title:     string
  subtitle?: string
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id:       string
  label:    string
  sub:      string
  category: 'incident' | 'responder' | 'citizen'
  href:     string
}

interface Notification {
  id:         string
  incidentId: string
  title:      string
  location:   string
  type:       string
  severity:   string
  eventType:  'new' | 'updated'
  createdAt:  string
  read:       boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ElementType> = {
  fire: Flame, flood: Waves, accident: Car, medical: Stethoscope, crime: ShieldAlert,
}

const TYPE_EMOJI: Record<string, string> = {
  fire: '🔥', flood: '🌊', medical: '🏥', accident: '🚗', crime: '🚨', other: '📋',
}

const SEVERITY_DOT: Record<string, string> = {
  urgent: 'bg-violet-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-green-500',
}

const CATEGORY_LABEL: Record<string, string> = {
  incident: '🚨 Incident', responder: '🧑‍🚒 Responder', citizen: '👤 Citizen',
}

const NOTIF_KEY = 'rs_notifications'
const READ_KEY  = 'rs_notif_read'

function loadReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')) } catch { return new Set() }
}
function saveReadIds(ids: Set<string>) {
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
}
function loadCachedNotifs(): Notification[] {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '[]') } catch { return [] }
}
function saveCachedNotifs(notifs: Notification[]) {
  localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs.slice(0, 20)))
}

// ─── Search dropdown ──────────────────────────────────────────────────────────

function SearchPanel({ onClose }: { onClose: () => void }) {
  const router  = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active,  setActive]  = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { inputRef.current?.focus() }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    const supabase = createClient()
    const term = `%${q.toLowerCase()}%`

    const [incidents, responders, citizens] = await Promise.all([
      supabase
        .from('incident_reports')
        .select('id, title, location, incident_type')
        .or(`title.ilike.${term},location.ilike.${term}`)
        .limit(5),
      supabase
        .from('responders')
        .select('id, first_name, last_name')
        .or(`first_name.ilike.${term},last_name.ilike.${term}`)
        .limit(5),
      supabase
        .from('citizens')
        .select('id, first_name, last_name, barangay')
        .or(`first_name.ilike.${term},last_name.ilike.${term}`)
        .limit(5),
    ])

    const out: SearchResult[] = []

    for (const r of incidents.data ?? []) {
      const emoji = TYPE_EMOJI[r.incident_type] ?? '📋'
      out.push({
        id: r.id, category: 'incident',
        label: `${emoji} ${r.title}`,
        sub: r.location ?? 'Unknown location',
        href: `/incidents?id=${r.id}`,
      })
    }
    for (const r of responders.data ?? []) {
      out.push({
        id: r.id, category: 'responder',
        label: `🧑‍🚒 ${r.first_name} ${r.last_name}`,
        sub: 'Responder',
        href: `/responders`,
      })
    }
    for (const r of citizens.data ?? []) {
      out.push({
        id: r.id, category: 'citizen',
        label: `👤 ${r.first_name} ${r.last_name}`,
        sub: r.barangay ? `Brgy. ${r.barangay}` : 'Citizen',
        href: `/citizens`,
      })
    }

    setResults(out)
    setLoading(false)
    setActive(-1)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceRef.current)
    // Debounce to avoid firing a query on every keystroke.
    debounceRef.current = setTimeout(() => search(val), 300)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape')     { onClose(); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActive(p => Math.min(p + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setActive(p => Math.max(p - 1, -1)) }
    if (e.key === 'Enter' && active >= 0) { navigate(results[active].href) }
  }

  function navigate(href: string) {
    router.push(href)
    onClose()
  }

  // Group results
  const grouped = (['incident', 'responder', 'citizen'] as const).reduce((acc, cat) => {
    const items = results.filter(r => r.category === cat)
    if (items.length) acc[cat] = items
    return acc
  }, {} as Record<string, SearchResult[]>)

  let globalIdx = -1

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="absolute top-full left-0 right-0 mt-0 z-50 mx-6">
        <div className="bg-surface-card border border-surface-border rounded-xl shadow-2xl overflow-hidden">
          {/* Input row */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border">
            <Search className="w-4 h-4 text-text-muted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={handleChange}
              onKeyDown={handleKey}
              placeholder="Search incidents, responders, citizens…"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
            {loading && <span className="w-4 h-4 rounded-full border-2 border-surface-muted border-t-brand-400 animate-spin shrink-0" />}
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results */}
          {query && (
            <div className="max-h-80 overflow-y-auto py-2">
              {results.length === 0 && !loading && (
                <p className="text-sm text-text-muted text-center py-6">No results for &ldquo;{query}&rdquo;</p>
              )}
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider px-4 py-1.5">
                    {CATEGORY_LABEL[cat]}
                  </p>
                  {items.map(item => {
                    globalIdx++
                    const idx = globalIdx
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.href)}
                        onMouseEnter={() => setActive(idx)}
                        className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                          active === idx ? 'bg-brand-600/10' : 'hover:bg-surface-muted/50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate">{item.label}</p>
                          <p className="text-xs text-text-muted truncate flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" /> {item.sub}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {!query && (
            <div className="py-6 text-center text-xs text-text-muted">
              Type to search across incidents, responders, and citizens
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Notifications dropdown ───────────────────────────────────────────────────

function NotifPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [notifs, setNotifs]   = useState<Notification[]>(() => {
    const cached  = loadCachedNotifs()
    const readIds = loadReadIds()
    return cached.map(n => ({ ...n, read: readIds.has(n.id) }))
  })

  const unreadCount = notifs.filter(n => !n.read).length

  // Load latest 20 from Supabase on open
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('incident_reports')
      .select('id, title, location, incident_type, severity, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!data) return
        const readIds = loadReadIds()
        const fresh: Notification[] = data.map(r => ({
          id:         r.id,
          incidentId: r.id,
          title:      r.title,
          location:   r.location ?? 'Unknown',
          type:       r.incident_type,
          severity:   r.severity,
          eventType:  'new' as const,
          createdAt:  r.created_at,
          read:       readIds.has(r.id),
        }))
        setNotifs(fresh)
        saveCachedNotifs(fresh)
      })
  }, [])

  // Realtime: new + updated incidents
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('topbar-notifs')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incident_reports',
      }, payload => {
        const row: any = payload.new
        if (!row?.id) return
        const readIds = loadReadIds()
        const notif: Notification = {
          id:         row.id,
          incidentId: row.id,
          title:      row.title,
          location:   row.location ?? 'Unknown',
          type:       row.incident_type,
          severity:   row.severity,
          eventType:  payload.eventType === 'INSERT' ? 'new' : 'updated',
          createdAt:  row.created_at,
          read:       readIds.has(row.id),
        }
        setNotifs(prev => {
          const without = prev.filter(n => n.id !== notif.id)
          const next = [notif, ...without].slice(0, 20)
          saveCachedNotifs(next)
          return next
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  function markRead(id: string) {
    const readIds = loadReadIds()
    readIds.add(id)
    saveReadIds(readIds)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  function markAllRead() {
    const readIds = loadReadIds()
    notifs.forEach(n => readIds.add(n.id))
    saveReadIds(readIds)
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
  }

  function handleClick(notif: Notification) {
    markRead(notif.id)
    router.push(`/incidents?id=${notif.incidentId}`)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="absolute top-full right-0 mt-2 z-50 w-80" style={{ marginRight: '1.5rem' }}>
        <div className="bg-surface-card border border-surface-border rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-text-secondary" />
              <span className="text-sm font-semibold text-text-primary">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-brand-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Feed */}
          <div className="max-h-96 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="py-10 text-center text-xs text-text-muted">No notifications yet</div>
            ) : (
              notifs.map(notif => {
                const Icon = TYPE_ICON[notif.type] ?? HelpCircle
                const dot  = SEVERITY_DOT[notif.severity] ?? 'bg-brand-500'
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-surface-border/50 hover:bg-surface-muted/40 transition-colors ${
                      !notif.read ? 'bg-brand-600/5' : ''
                    }`}
                  >
                    {/* Icon circle */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      notif.type === 'fire'     ? 'bg-orange-500/10 text-orange-400' :
                      notif.type === 'flood'    ? 'bg-blue-500/10   text-blue-400'   :
                      notif.type === 'medical'  ? 'bg-green-500/10  text-green-400'  :
                      notif.type === 'accident' ? 'bg-yellow-500/10 text-yellow-400' :
                      notif.type === 'crime'    ? 'bg-violet-500/10 text-violet-400' :
                                                  'bg-surface-muted text-text-muted'
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-xs font-semibold leading-snug truncate ${notif.read ? 'text-text-secondary' : 'text-text-primary'}`}>
                          {notif.eventType === 'new' ? '🆕 ' : '🔄 '}{notif.title}
                        </p>
                        {!notif.read && <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${dot}`} />}
                      </div>
                      <p className="text-[11px] text-text-muted flex items-center gap-1 mt-0.5 truncate">
                        <MapPin className="w-2.5 h-2.5 shrink-0" /> {notif.location}
                      </p>
                      <p className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5 shrink-0" /> {timeAgo(notif.createdAt)}
                      </p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

export function TopBar({ title, subtitle }: TopBarProps) {
  const { theme, toggleTheme } = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen,  setNotifOpen]  = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Load unread count from localStorage on mount and keep it in sync
  useEffect(() => {
    function calcUnread() {
      const cached  = loadCachedNotifs()
      const readIds = loadReadIds()
      setUnreadCount(cached.filter(n => !readIds.has(n.id)).length)
    }
    calcUnread()
    // Listen for storage changes (mark-all-read in another tab, etc.)
    window.addEventListener('storage', calcUnread)
    return () => window.removeEventListener('storage', calcUnread)
  }, [])

  // Realtime: bump unread count when a new incident arrives (panel closed)
  useEffect(() => {
    if (notifOpen) return // panel manages its own state when open
    const supabase = createClient()
    const channel = supabase
      .channel('topbar-badge')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'incident_reports',
      }, payload => {
        const row: any = payload.new
        if (!row?.id) return
        // Add to cache as unread
        const cached  = loadCachedNotifs()
        const readIds = loadReadIds()
        if (!cached.find(n => n.id === row.id)) {
          const notif: Notification = {
            id:         row.id,
            incidentId: row.id,
            title:      row.title,
            location:   row.location ?? 'Unknown',
            type:       row.incident_type,
            severity:   row.severity,
            eventType:  'new',
            createdAt:  row.created_at,
            read:       false,
          }
          const next = [notif, ...cached].slice(0, 20)
          saveCachedNotifs(next)
          setUnreadCount(next.filter(n => !readIds.has(n.id)).length + 1)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [notifOpen])

  // Close search on Escape globally
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  function openSearch() {
    setNotifOpen(false)
    setSearchOpen(true)
  }
  function openNotif() {
    setSearchOpen(false)
    setNotifOpen(v => !v)
    // recount after open
    setTimeout(() => {
      const cached  = loadCachedNotifs()
      const readIds = loadReadIds()
      setUnreadCount(cached.filter(n => !readIds.has(n.id)).length)
    }, 50)
  }

  return (
    <header
      className="h-16 border-b border-surface-border flex items-center justify-between px-6 sticky top-0 z-30 relative"
      style={{ backgroundColor: 'var(--bg-card)', backdropFilter: 'blur(8px)' }}
    >
      <div>
        <h1 className="text-base font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Search trigger */}
        <button
          onClick={openSearch}
          className="hidden md:flex items-center gap-2 bg-surface-muted border border-surface-border rounded-lg pl-3 pr-4 py-1.5 text-sm text-text-muted hover:border-brand-500/40 hover:text-text-secondary transition-colors w-52"
        >
          <Search className="w-3.5 h-3.5 shrink-0" />
          <span className="text-sm">Search…</span>
        </button>

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
        <div className="relative">
          <button
            onClick={openNotif}
            className="relative w-9 h-9 rounded-lg bg-surface-muted border border-surface-border flex items-center justify-center hover:border-brand-600/40 transition-colors"
          >
            <Bell className="w-4 h-4 text-text-secondary" />
            {unreadCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-brand-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-500 rounded-full" />
            )}
          </button>

          {notifOpen && (
            <NotifPanel onClose={() => {
              setNotifOpen(false)
              // refresh badge after panel close
              const cached  = loadCachedNotifs()
              const readIds = loadReadIds()
              setUnreadCount(cached.filter(n => !readIds.has(n.id)).length)
            }} />
          )}
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-critical/10 border border-status-critical/20">
          <span className="w-1.5 h-1.5 bg-status-critical rounded-full animate-pulse-slow" />
          <span className="text-xs font-medium text-status-critical">LIVE</span>
        </div>
      </div>

      {/* Search panel — full-width below TopBar */}
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}
    </header>
  )
}
