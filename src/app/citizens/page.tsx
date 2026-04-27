'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar } from '@/components/layout/TopBar'
import { format } from 'date-fns'
import {
  Users, ShieldCheck, ShieldOff, Search, MapPin,
  ChevronDown, ChevronUp, FileText, Star, AlertTriangle, Ban, TriangleAlert,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Citizen {
  id: string
  email: string
  first_name: string
  last_name: string
  middle_initial: string | null
  barangay: string | null
  zone: string | null
  verified: boolean
  is_banned: boolean
  fake_report_count: number
  created_at: string
  // joined from sub-queries
  report_count: number
  avg_rating: number | null
}

type SortKey = 'name' | 'barangay' | 'verified' | 'reports' | 'joined' | 'warnings'
type SortDir = 'asc' | 'desc'
type VerifFilter = 'all' | 'verified' | 'unverified'
type StatusFilter = 'all' | 'active' | 'banned'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ratingColor = (r: number) =>
  r >= 4.5 ? 'text-emerald-400' : r >= 3.5 ? 'text-green-400' :
  r >= 2.5 ? 'text-yellow-400'  : r >= 1.5 ? 'text-orange-400' : 'text-violet-400'

function Avatar({ name, verified }: { name: string; verified: boolean }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="relative shrink-0">
      <div className="w-9 h-9 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center text-brand-400 font-bold text-xs">
        {initials}
      </div>
      {verified && (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-surface-card flex items-center justify-center">
          <ShieldCheck className="w-2 h-2 text-white" />
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string | number; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div>
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-2xl font-bold text-text-primary leading-none mt-0.5">{value}</p>
        {sub && <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CitizensPage() {
  const supabase = createClient()
  const [citizens, setCitizens] = useState<Citizen[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [barangayFilter, setBarangay] = useState<string | null>(null)
  const [verifFilter, setVerifFilter] = useState<VerifFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey]   = useState<SortKey>('joined')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [barangayOpen, setBrgyOpen] = useState(false)

  useEffect(() => { fetchCitizens() }, [])

  async function fetchCitizens() {
    setLoading(true)
    try {
      // Fetch all citizens
      const { data: users, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, middle_initial, barangay, zone, verified, is_banned, fake_report_count, created_at')
        .eq('role', 'citizen')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error || !users?.length) { setLoading(false); return }

      // Fetch report counts per citizen — use user_id (the actual FK column name)
      // Select with count using group-by via RPC to avoid the 1000-row default limit
      const { data: reportCounts } = await supabase
        .from('incident_reports')
        .select('user_id')
        .limit(10000)
      const countMap: Record<string, number> = {}
      reportCounts?.forEach((r: any) => {
        if (r.user_id) countMap[r.user_id] = (countMap[r.user_id] ?? 0) + 1
      })

      // Fetch avg ratings — join via user_id
      const { data: ratings } = await supabase
        .from('response_ratings')
        .select('rating, report:incident_reports(user_id)')
        .limit(10000)
      const ratingMap: Record<string, number[]> = {}
      ratings?.forEach((r: any) => {
        const cid = r.report?.user_id
        if (cid && r.rating != null) {
          ratingMap[cid] = ratingMap[cid] ?? []
          ratingMap[cid].push(r.rating)
        }
      })

      setCitizens(users.map((u: any) => ({
        ...u,
        verified:          u.verified ?? false,
        is_banned:         u.is_banned ?? false,
        fake_report_count: u.fake_report_count ?? 0,
        report_count:      countMap[u.id] ?? 0,
        avg_rating: ratingMap[u.id]?.length
          ? Math.round((ratingMap[u.id].reduce((a: number, b: number) => a + b, 0) / ratingMap[u.id].length) * 10) / 10
          : null,
      })))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const barangays = useMemo(() =>
    [...new Set(citizens.map(c => c.barangay).filter(Boolean) as string[])].sort(),
    [citizens])

  const stats = useMemo(() => ({
    total:       citizens.length,
    verified:    citizens.filter(c => c.verified).length,
    withReports: citizens.filter(c => c.report_count > 0).length,
    banned:      citizens.filter(c => c.is_banned).length,
    warned:      citizens.filter(c => c.fake_report_count > 0 && !c.is_banned).length,
  }), [citizens])

  const filtered = useMemo(() => {
    let list = [...citizens]

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.barangay?.toLowerCase().includes(q))
      )
    }

    if (barangayFilter) list = list.filter(c => c.barangay === barangayFilter)

    if (verifFilter === 'verified')   list = list.filter(c => c.verified)
    if (verifFilter === 'unverified') list = list.filter(c => !c.verified)
    if (statusFilter === 'banned') list = list.filter(c => c.is_banned)
    if (statusFilter === 'active') list = list.filter(c => !c.is_banned)

    list.sort((a, b) => {
      let va: any, vb: any
      switch (sortKey) {
        case 'name':     va = `${a.first_name} ${a.last_name}`; vb = `${b.first_name} ${b.last_name}`; break
        case 'barangay': va = a.barangay ?? ''; vb = b.barangay ?? ''; break
        case 'verified': va = a.verified ? 1 : 0; vb = b.verified ? 1 : 0; break
        case 'reports':  va = a.report_count; vb = b.report_count; break
        case 'warnings': va = a.fake_report_count; vb = b.fake_report_count; break
        case 'joined':   va = a.created_at; vb = b.created_at; break
      }
      return sortDir === 'asc'
        ? va < vb ? -1 : va > vb ? 1 : 0
        : va > vb ? -1 : va < vb ? 1 : 0
    })

    return list
  }, [citizens, search, barangayFilter, verifFilter, statusFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronDown className="w-3 h-3 opacity-30" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-brand-400" />
      : <ChevronDown className="w-3 h-3 text-brand-400" />
  }

  // ── Expanded detail row ──────────────────────────────────────────────────

  function ExpandedRow({ c }: { c: Citizen }) {
    return (
      <tr className="bg-surface-muted/40">
        <td colSpan={8} className="px-5 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="space-y-1">
              <p className="text-text-muted font-semibold uppercase tracking-wider text-[10px]">Account</p>
              <p className="text-text-primary">{c.email}</p>
              <p className="text-text-muted">Joined {format(new Date(c.created_at), 'MMM d, yyyy')}</p>
            </div>
            <div className="space-y-1">
              <p className="text-text-muted font-semibold uppercase tracking-wider text-[10px]">Location</p>
              <p className="text-text-primary">Brgy. {c.barangay ?? '—'}</p>
              <p className="text-text-muted">{c.zone ?? '—'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-text-muted font-semibold uppercase tracking-wider text-[10px]">Reports</p>
              <p className="text-text-primary">{c.report_count} incident{c.report_count !== 1 ? 's' : ''} filed</p>
              {c.avg_rating != null && (
                <p className={`font-semibold ${ratingColor(c.avg_rating)}`}>
                  Avg. rating received: {c.avg_rating} ★
                </p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-text-muted font-semibold uppercase tracking-wider text-[10px]">Status</p>
              <div className="flex items-center gap-1.5">
                {c.verified
                  ? <><ShieldCheck className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400 font-semibold">Verified</span></>
                  : <><ShieldOff className="w-3.5 h-3.5 text-orange-400" /><span className="text-orange-400 font-semibold">Not verified</span></>
                }
              </div>
              {c.is_banned ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <Ban className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-red-400 font-bold">Account Banned</span>
                </div>
              ) : c.fake_report_count > 0 ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <TriangleAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-400 font-semibold">{c.fake_report_count} warning{c.fake_report_count !== 1 ? 's' : ''} issued</span>
                </div>
              ) : null}
            </div>
          </div>
        </td>
      </tr>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <TopBar title="Citizens" subtitle="Registered citizen accounts and verification status" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Citizens" value={stats.total}    icon={Users}         color="#3b82f6" />
          <StatCard label="Verified"       value={stats.verified} icon={ShieldCheck}   color="#22c55e"
            sub={stats.total ? `${Math.round(stats.verified / stats.total * 100)}% of total` : undefined} />
          <StatCard label="Warned"         value={stats.warned}   icon={TriangleAlert} color="#f59e0b"
            sub="Has fake report warning" />
          <StatCard label="Banned"         value={stats.banned}   icon={Ban}           color="#ef4444"
            sub="3 fake reports recorded" />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email or barangay…"
              className="w-full pl-8 pr-3 py-2 rounded-lg text-xs bg-surface-muted border border-surface-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500/50"
            />
          </div>

          {/* Barangay filter */}
          <div className="relative">
            <button
              onClick={() => setBrgyOpen(o => !o)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all
                ${barangayFilter ? 'bg-brand-600/10 border-brand-600/30 text-brand-400' : 'border-surface-border text-text-muted hover:text-text-secondary'}`}
            >
              <MapPin className="w-3.5 h-3.5" />
              {barangayFilter ? `Brgy. ${barangayFilter}` : 'All Barangays'}
              <ChevronDown className={`w-3 h-3 transition-transform ${barangayOpen ? 'rotate-180' : ''}`} />
            </button>
            {barangayOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBrgyOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-20 w-52 max-h-64 overflow-y-auto bg-surface-card border border-surface-border rounded-xl shadow-2xl py-1">
                  <button onClick={() => { setBarangay(null); setBrgyOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${!barangayFilter ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}`}>
                    All Barangays
                  </button>
                  <div className="h-px bg-surface-border my-1" />
                  {barangays.map(b => (
                    <button key={b} onClick={() => { setBarangay(b); setBrgyOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors
                        ${barangayFilter === b ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}`}>
                      Brgy. {b}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Status filter */}
          <div className="flex gap-1 p-1 bg-surface-muted rounded-lg border border-surface-border">
            {(['all', 'active', 'banned'] as StatusFilter[]).map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all
                  ${statusFilter === f ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                {f === 'banned' ? '🚫 Banned' : f === 'active' ? '✅ Active' : 'All'}
              </button>
            ))}
          </div>

          {/* Verification filter */}
          <div className="flex gap-1 p-1 bg-surface-muted rounded-lg border border-surface-border">
            {(['all', 'verified', 'unverified'] as VerifFilter[]).map(f => (
              <button key={f} onClick={() => setVerifFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all
                  ${verifFilter === f ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                {f}
              </button>
            ))}
          </div>

          <span className="text-xs text-text-muted ml-auto">
            {filtered.length} of {citizens.length}
          </span>
        </div>

        {/* Table */}
        <div className="glass rounded-xl overflow-hidden">
          {loading ? (
            <div className="h-64 flex items-center justify-center text-sm text-text-muted animate-pulse">
              Loading citizens…
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2">
              <Users className="w-8 h-8 text-text-muted opacity-30" />
              <p className="text-sm text-text-muted">No citizens match your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-muted/50">
                    {[
                      { key: 'name'     as SortKey, label: 'Citizen'    },
                      { key: 'barangay' as SortKey, label: 'Barangay'   },
                      { key: 'verified' as SortKey, label: 'Verified'   },
                      { key: 'reports'  as SortKey, label: 'Reports'    },
                      { key: 'warnings' as SortKey, label: 'Warnings'   },
                      { key: null,                  label: 'Avg. Rating' },
                      { key: 'joined'   as SortKey, label: 'Joined'     },
                      { key: null,                  label: ''            },
                    ].map(({ key, label }, i) => (
                      <th key={i}
                        onClick={key ? () => toggleSort(key) : undefined}
                        className={`text-left px-4 py-3 text-[11px] font-semibold text-text-muted uppercase tracking-wider
                          ${key ? 'cursor-pointer select-none hover:text-text-secondary' : ''}`}
                      >
                        <div className="flex items-center gap-1">
                          {label}
                          {key && <SortIcon k={key} />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {filtered.map(c => (
                    <>
                      <tr
                        key={c.id}
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        className={`hover:bg-surface-muted/40 cursor-pointer transition-colors ${c.is_banned ? 'bg-red-500/5' : ''}`}
                      >
                        {/* Name + avatar */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={`${c.first_name} ${c.last_name}`} verified={c.verified} />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-text-primary">
                                  {c.first_name}{c.middle_initial ? ` ${c.middle_initial}.` : ''} {c.last_name}
                                </p>
                                {c.is_banned && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">
                                    <Ban className="w-2.5 h-2.5" /> BANNED
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-text-muted">{c.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Barangay */}
                        <td className="px-4 py-3">
                          {c.barangay ? (
                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                              <MapPin className="w-3 h-3 text-text-muted shrink-0" />
                              Brgy. {c.barangay}
                              {c.zone && <span className="text-text-muted">· {c.zone}</span>}
                            </div>
                          ) : <span className="text-text-muted text-xs">—</span>}
                        </td>

                        {/* Verified */}
                        <td className="px-4 py-3">
                          {c.verified ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
                              <ShieldCheck className="w-3 h-3" /> Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500/10 border border-orange-500/20 text-orange-400">
                              <ShieldOff className="w-3 h-3" /> Unverified
                            </span>
                          )}
                        </td>

                        {/* Report count */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3 text-text-muted shrink-0" />
                            <span className={`text-sm font-semibold ${c.report_count > 0 ? 'text-text-primary' : 'text-text-muted'}`}>
                              {c.report_count}
                            </span>
                          </div>
                        </td>

                        {/* Warnings */}
                        <td className="px-4 py-3">
                          {c.fake_report_count > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <TriangleAlert className={`w-3 h-3 shrink-0 ${c.is_banned ? 'text-red-400' : 'text-amber-400'}`} />
                              <span className={`text-sm font-bold ${c.is_banned ? 'text-red-400' : 'text-amber-400'}`}>
                                {c.fake_report_count}/3
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                        </td>

                        {/* Avg rating */}
                        <td className="px-4 py-3">
                          {c.avg_rating != null ? (
                            <div className="flex items-center gap-1">
                              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                              <span className={`text-sm font-semibold ${ratingColor(c.avg_rating)}`}>
                                {c.avg_rating}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                        </td>

                        {/* Joined */}
                        <td className="px-4 py-3">
                          <span className="text-xs text-text-muted">
                            {format(new Date(c.created_at), 'MMM d, yyyy')}
                          </span>
                        </td>

                        {/* Expand toggle */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-surface-muted transition-colors">
                            {expanded === c.id
                              ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" />
                              : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
                          </div>
                        </td>
                      </tr>

                      {expanded === c.id && <ExpandedRow key={`${c.id}-exp`} c={c} />}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </AppShell>
  )
}
