'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar } from '@/components/layout/TopBar'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import {
  AlertTriangle, Users, Clock, Activity, MapPin,
  Flame, Waves, Car, Stethoscope, ShieldAlert, HelpCircle,
  X, ChevronRight, User, Shield, FileText, CheckCircle,
  RefreshCw,
} from 'lucide-react'
import { useAgencySession, isCDRRMO, agencyFilter } from '@/hooks/useAgencySession'
import { timeAgo, formatDateTime } from '@/lib/utils'
import type { MapIncident, ResponderLocation } from '@/app/map/page'

const LiveDispatchMap = dynamic(() => import('@/components/map/LiveDispatchMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-surface text-text-muted text-sm gap-2">
      <RefreshCw className="w-4 h-4 animate-spin" /> Loading map…
    </div>
  ),
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface Report {
  id: string
  incident_type: string
  title: string
  description: string
  location: string
  status: string
  severity: string
  created_at: string
  reporter_name: string | null
  responder_name: string | null
  resolution_notes: string | null
  agency_type: string | null
}

interface Stats {
  active: number
  resolved: number
  responders: number
  avgResponse: number | null
  activeDelta: number | null   // change vs yesterday
  resolvedDelta: number | null
}

type KpiModal = 'active' | 'resolved' | 'responders' | 'avgResponse' | null

interface SeverityCount {
  urgent: number
  high: number
  medium: number
  low: number
}

// ─── Incident type icons ──────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ElementType> = {
  fire: Flame,
  flood: Waves,
  accident: Car,
  medical: Stethoscope,
  crime: ShieldAlert,
}
const TYPE_COLOR: Record<string, string> = {
  fire: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  flood: 'text-blue-400   bg-blue-500/10   border-blue-500/20',
  accident: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  medical: 'text-green-400  bg-green-500/10  border-green-500/20',
  crime: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function ReportDetailModal({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Severity accent strip */}
        <div className={`h-1 w-full ${report.severity === 'urgent' ? 'bg-violet-500' :
            report.severity === 'high' ? 'bg-orange-500' :
              report.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
          }`} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-surface-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Badge variant="severity" value={report.severity as any}>{report.severity}</Badge>
              <Badge variant="status" value={report.status as any}>{report.status.replace('_', ' ')}</Badge>
              {report.agency_type && (
                <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                  {report.agency_type}
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold text-text-primary leading-snug">{report.title}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center transition-colors shrink-0">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">

          {/* Type badge */}
          {(() => {
            const Icon = TYPE_ICON[report.incident_type] ?? HelpCircle
            const cls = TYPE_COLOR[report.incident_type] ?? 'text-text-muted bg-surface-muted border-surface-border'
            return (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${cls}`}>
                <Icon className="w-3.5 h-3.5" />
                {report.incident_type.charAt(0).toUpperCase() + report.incident_type.slice(1)}
              </div>
            )
          })()}

          {/* Description */}
          {report.description && (
            <div>
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Description</p>
              <p className="text-sm text-text-primary leading-relaxed">{report.description}</p>
            </div>
          )}

          {/* Location + time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-muted border border-surface-border rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-medium mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Location
              </p>
              <p className="text-xs text-text-primary leading-snug">{report.location}</p>
            </div>
            <div className="bg-surface-muted border border-surface-border rounded-lg p-3">
              <p className="text-[10px] text-text-muted font-medium mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Reported
              </p>
              <p className="text-xs text-text-primary">{formatDateTime(report.created_at)}</p>
            </div>
          </div>

          {/* People */}
          <div className="space-y-2">
            {report.reporter_name && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-muted border border-surface-border">
                <div className="w-7 h-7 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Reported by</p>
                  <p className="text-xs font-semibold text-text-primary">{report.reporter_name}</p>
                </div>
              </div>
            )}
            {report.responder_name ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-muted border border-surface-border">
                <div className="w-7 h-7 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <Shield className="w-3.5 h-3.5 text-violet-400" />
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Responder</p>
                  <p className="text-xs font-semibold text-text-primary">{report.responder_name}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-muted border border-surface-border">
                <div className="w-7 h-7 rounded-full bg-surface-muted border border-surface-border flex items-center justify-center shrink-0">
                  <Shield className="w-3.5 h-3.5 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted italic">No responder assigned yet</p>
              </div>
            )}
          </div>

          {/* Resolution notes */}
          {report.resolution_notes && (
            <div>
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Resolution Notes</p>
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2.5">
                <p className="text-xs text-text-primary leading-relaxed">{report.resolution_notes}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-surface-border flex justify-end">
          <a href="/incidents" className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
            View in Incidents <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient()
  const session = useAgencySession()

  const [reports, setReports] = useState<Report[]>([])
  const [stats, setStats] = useState<Stats>({ active: 0, resolved: 0, responders: 0, avgResponse: null, activeDelta: null, resolvedDelta: null })
  const [severity, setSeverity] = useState<SeverityCount>({ urgent: 0, high: 0, medium: 0, low: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Report | null>(null)
  const [kpiModal, setKpiModal] = useState<KpiModal>(null)

  // Map state
  const [mapIncidents, setMapIncidents] = useState<MapIncident[]>([])
  const [mapResponders, setMapResponders] = useState<ResponderLocation[]>([])
  const [selResponderId, setSelResponderId] = useState<string | null>(null)
  const [selIncidentId, setSelIncidentId] = useState<string | null>(null)

  const fetchReports = useCallback(async () => {
    // Fetch the latest incident cards for the dashboard list.
    let q = supabase
      .from('incident_reports')
      .select(`
        id, incident_type, title, description, location, status, severity, created_at, resolution_notes,
        agency:agencies!incident_reports_routed_agency_id_fkey(type),
        reporter:users!incident_reports_user_id_fkey(first_name, last_name),
        responder:users!incident_reports_responder_id_fkey(first_name, last_name)
      `)
      .order('created_at', { ascending: false })
      .limit(8)
    const filter = agencyFilter(session)
    if (filter) q = q.eq('routed_agency_id', filter)
    const { data } = await q
    if (data) {
      setReports(data.map((r: any) => ({
        ...r,
        agency_type: r.agency?.type ?? null,
        reporter_name: r.reporter ? `${r.reporter.first_name} ${r.reporter.last_name}` : null,
        responder_name: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : null,
      })))
    }
  }, [session])

  const fetchStats = useCallback(async () => {
    const filter = agencyFilter(session)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const todayISO = today.toISOString()
    const yesterdayISO = yesterday.toISOString()

    // Single query: fetch all reports from yesterday onward + response times.
    // Derive active/resolved counts client-side — 1 round-trip instead of 6.
    let reportQ = supabase
      .from('incident_reports')
      .select('status, created_at, response_time_minutes')
      .gte('created_at', yesterdayISO)
    if (filter) reportQ = reportQ.eq('routed_agency_id', filter)

    // Responder count is a separate table — run in parallel
    let respQ = supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'responder')
    if (filter) respQ = respQ.eq('agency_id', filter)

    const [{ data: rows }, { count: responders }] = await Promise.all([reportQ, respQ])

    if (!rows) return

    let active = 0, activeYest = 0, resolved = 0, resolvedYest = 0
    let rtSum = 0, rtCount = 0
    for (const r of rows) {
      const isToday = r.created_at >= todayISO
      const isActive = ['pending', 'verified', 'responding'].includes(r.status)
      const isResolved = r.status === 'resolved'
      if (isActive) active++
      if (isActive && !isToday) activeYest++
      if (isResolved && isToday) resolved++
      if (isResolved && !isToday) resolvedYest++
      if (r.response_time_minutes != null) { rtSum += r.response_time_minutes; rtCount++ }
    }

    setStats({
      active,
      resolved,
      responders: responders ?? 0,
      avgResponse: rtCount > 0 ? Math.round(rtSum / rtCount * 10) / 10 : null,
      activeDelta: active - activeYest,
      resolvedDelta: resolved - resolvedYest,
    })
  }, [session])

  const fetchSeverity = useCallback(async () => {
    const { data } = await supabase
      .from('incident_reports')
      .select('severity')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    if (!data) return
    const counts = { urgent: 0, high: 0, medium: 0, low: 0 }
    data.forEach(r => { if (r.severity in counts) counts[r.severity as keyof typeof counts]++ })
    setSeverity(counts)
  }, [])

  const fetchMapData = useCallback(async () => {
    const filter = agencyFilter(session)

    // Fetch active incidents with coordinates
    let incQ = supabase
      .from('incident_reports')
      .select(`
        id, incident_type, title, location, status, severity, created_at,
        latitude, longitude,
        responder:users!incident_reports_responder_id_fkey(first_name, last_name)
      `)
      .in('status', ['pending', 'verified', 'responding'])
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (filter) incQ = incQ.eq('routed_agency_id', filter)
    const { data: incData } = await incQ

    if (incData) {
      setMapIncidents(incData.map((r: any) => ({
        ...r,
        responder_name: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : null,
      })))
    }

    // Fetch online responders
    let respQ = supabase
      .from('responder_locations')
      .select(`
        responder_id, latitude, longitude, heading, speed, updated_at,
        responder:users!responder_locations_responder_id_fkey(first_name, last_name, responder_status)
      `)
      .gte('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    if (filter) respQ = respQ.eq('agency_id', filter)
    const { data: respData } = await respQ

    if (respData) {
      setMapResponders(respData.map((r: any) => ({
        responder_id: r.responder_id,
        first_name: r.responder?.first_name ?? 'Unknown',
        last_name: r.responder?.last_name ?? '',
        latitude: r.latitude,
        longitude: r.longitude,
        heading: r.heading,
        speed: r.speed,
        updated_at: r.updated_at,
        responder_status: r.responder?.status ?? 'online',
      })))
    }
  }, [session])

  const fetchAll = useCallback(async () => {
    // Pull all dashboard widgets in parallel to keep load time consistent.
    setLoading(true)
    await Promise.all([fetchReports(), fetchStats(), fetchSeverity(), fetchMapData()])
    setLoading(false)
  }, [fetchReports, fetchStats, fetchSeverity, fetchMapData])

  useEffect(() => {
    fetchAll()

    // On realtime events only refresh stats + severity counts (cheap count queries).
    // fetchReports() is also small (8 rows) so include it. Avoid re-running on
    // every event by debouncing — multiple rapid inserts collapse into one refresh.
    let debounceTimer: ReturnType<typeof setTimeout>
    function handleChange() {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        Promise.all([fetchReports(), fetchStats(), fetchSeverity()])
      }, 600)
    }

    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_reports' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'responder_locations' }, handleChange)
      .subscribe()
    return () => {
      clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [fetchAll])

  // ── Derived ──────────────────────────────────────────────────────────────
  const total = Object.values(severity).reduce((a, b) => a + b, 0) || 1
  const severityColors: Record<string, string> = {
    urgent: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-emerald-500',
  }
  const severityDotColors: Record<string, string> = {
    urgent: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-emerald-500',
  }

  const activeDeltaStr = stats.activeDelta != null ? `${stats.activeDelta > 0 ? '+' : ''}${stats.activeDelta} vs yesterday` : undefined
  const resolvedDeltaStr = stats.resolvedDelta != null ? `${stats.resolvedDelta > 0 ? '+' : ''}${stats.resolvedDelta} vs yesterday` : undefined

  // ── KPI Detail Modal ────────────────────────────────────────────────────
  function KpiDetailModal() {
    if (!kpiModal) return null
    const titles: Record<string, string> = {
      active: 'Active Incidents',
      resolved: 'Resolved Today',
      responders: 'Responders',
      avgResponse: 'Avg Response Time',
    }
    const details: Record<string, { label: string; value: string | number }[]> = {
      active: [
        { label: 'Currently active', value: stats.active },
        { label: 'Urgent', value: severity.urgent },
        { label: 'High', value: severity.high },
        { label: 'Medium', value: severity.medium },
        { label: 'Low', value: severity.low },
        { label: 'Change vs yesterday', value: activeDeltaStr ?? 'N/A' },
      ],
      resolved: [
        { label: 'Resolved today', value: stats.resolved },
        { label: 'Change vs yesterday', value: resolvedDeltaStr ?? 'N/A' },
      ],
      responders: [
        { label: 'Total responders', value: stats.responders },
        { label: 'On map (last 30m)', value: mapResponders.length },
        { label: 'On scene', value: mapResponders.filter(r => r.responder_status === 'on_scene').length },
        { label: 'Online / en-route', value: mapResponders.filter(r => r.responder_status !== 'on_scene').length },
      ],
      avgResponse: [
        { label: 'Avg response time', value: stats.avgResponse ? `${stats.avgResponse} min` : 'N/A' },
        { label: 'Based on', value: 'Resolved reports today' },
      ],
    }
    return (
      <div className="fixed inset-0 z-[900] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setKpiModal(null)} />
        <div className="relative w-full max-w-sm bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-text-primary">{titles[kpiModal]}</h2>
            <button onClick={() => setKpiModal(null)} className="w-7 h-7 rounded-lg hover:bg-surface-muted flex items-center justify-center">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-3">
            {details[kpiModal].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className="text-xs font-semibold text-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-surface-border flex justify-end">
            <a href="/incidents" className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors">
              View Incidents <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      <TopBar title="Dashboard" subtitle="Real-time emergency overview" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">

        {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">

          {/* Active Incidents */}
          <button onClick={() => setKpiModal('active')} className="text-left focus:outline-none">
            <div className="glass rounded-xl p-5 cursor-pointer transition-all hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/10 group animate-slide-up">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg border bg-orange-500/10 border-orange-500/20 text-orange-400 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                {activeDeltaStr && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stats.activeDelta != null && stats.activeDelta <= 0
                      ? 'text-green-400 bg-green-400/10'
                      : 'text-orange-400 bg-orange-400/10'
                    }`}>{activeDeltaStr}</span>
                )}
              </div>
              <p className="text-2xl font-bold text-text-primary tabular-nums">{loading ? '—' : stats.active}</p>
              <p className="text-xs text-text-secondary mt-0.5">Active Incidents</p>
            </div>
          </button>

          {/* Resolved Today */}
          <button onClick={() => setKpiModal('resolved')} className="text-left focus:outline-none">
            <div className="glass rounded-xl p-5 cursor-pointer transition-all hover:border-green-500/40 hover:shadow-lg hover:shadow-green-500/10 group animate-slide-up">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg border bg-green-500/10 border-green-500/20 text-green-400 flex items-center justify-center">
                  <Activity className="w-5 h-5" />
                </div>
                {resolvedDeltaStr && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stats.resolvedDelta != null && stats.resolvedDelta >= 0
                      ? 'text-green-400 bg-green-400/10'
                      : 'text-brand-400 bg-brand-400/10'
                    }`}>{resolvedDeltaStr}</span>
                )}
              </div>
              <p className="text-2xl font-bold text-text-primary tabular-nums">{loading ? '—' : stats.resolved}</p>
              <p className="text-xs text-text-secondary mt-0.5">Resolved Today</p>
            </div>
          </button>

          {/* Responders */}
          <button onClick={() => setKpiModal('responders')} className="text-left focus:outline-none">
            <div className="glass rounded-xl p-5 cursor-pointer transition-all hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/10 group animate-slide-up">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg border bg-blue-500/10 border-blue-500/20 text-blue-400 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-bold text-text-primary tabular-nums">{loading ? '—' : stats.responders}</p>
              <p className="text-xs text-text-secondary mt-0.5">Responders</p>
            </div>
          </button>

          {/* Avg Response Time */}
          <button onClick={() => setKpiModal('avgResponse')} className="text-left focus:outline-none">
            <div className="glass rounded-xl p-5 cursor-pointer transition-all hover:border-yellow-500/40 hover:shadow-lg hover:shadow-yellow-500/10 group animate-slide-up">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-lg border bg-yellow-500/10 border-yellow-500/20 text-yellow-400 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-bold text-text-primary tabular-nums">{loading ? '—' : stats.avgResponse ? `${stats.avgResponse} min` : 'N/A'}</p>
              <p className="text-xs text-text-secondary mt-0.5">Avg Response Time</p>
            </div>
          </button>

        </div>

        {/* ── Main content: Map (left 2/3) + Sidebar (right 1/3) ────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Map — explicit pixel height so Leaflet renders correctly */}
          <div className="xl:col-span-2 glass rounded-xl overflow-hidden" style={{ height: '460px' }}>
            <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between" style={{ height: '53px' }}>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand-400" />
                <div>
                  <h2 className="text-sm font-semibold text-text-primary leading-none">Live Dispatch Map</h2>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {mapIncidents.length} active · {mapResponders.length} responder{mapResponders.length !== 1 ? 's' : ''} online
                  </p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2.5">
                {[
                  { label: 'Urgent', color: '#f43f5e' },
                  { label: 'High', color: '#f97316' },
                  { label: 'Medium', color: '#fbbf24' },
                  { label: 'Low', color: '#22c55e' },
                ].map(item => (
                  <span key={item.label} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                    <span className="text-[10px] text-text-muted">{item.label}</span>
                  </span>
                ))}
                <span className="flex items-center gap-1 ml-1 pl-2 border-l border-surface-border">
                  <span className="text-xs">🧑‍🚒</span>
                  <span className="text-[10px] text-text-muted">Responder</span>
                </span>
              </div>
            </div>
            {/* Explicit pixel height = total - header. Leaflet MUST have a concrete px height */}
            <div className="relative" style={{ height: '407px' }}>
              <LiveDispatchMap
                responders={mapResponders}
                incidents={mapIncidents}
                selectedResponderId={selResponderId}
                selectedIncidentId={selIncidentId}
                onSelectResponder={setSelResponderId}
                onSelectIncident={setSelIncidentId}
              />
            </div>
          </div>

          {/* Right sidebar: Severity + System Status */}
          <div className="flex flex-col gap-4">

            {/* Severity Breakdown */}
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-text-primary">Severity Breakdown</h2>
                <p className="text-[11px] text-text-muted mt-0.5">Last 24 hours · {total} report{total !== 1 ? 's' : ''}</p>
              </div>
              <div className="p-5 space-y-3.5">
                {(['urgent', 'high', 'medium', 'low'] as const).map(label => {
                  const val = severity[label]
                  const pct = Math.round((val / total) * 100)
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${severityDotColors[label]}`} />
                          <span className="capitalize text-text-secondary font-medium">{label}</span>
                        </div>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="text-text-primary font-semibold">{val}</span>
                          <span className="text-text-muted text-[10px]">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${severityColors[label]}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* System Status */}
            <div className="glass rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-text-primary">System Status</h2>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Realtime updates</span>
                  <span className="flex items-center gap-1.5 text-xs text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Map responders</span>
                  <span className="text-xs font-semibold text-text-primary">{mapResponders.length} tracked</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Open incidents</span>
                  <span className="text-xs font-semibold text-text-primary">{mapIncidents.length} on map</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Avg response time</span>
                  <span className="text-xs font-semibold text-text-primary">
                    {stats.avgResponse != null ? `${stats.avgResponse} min` : 'N/A'}
                  </span>
                </div>
              </div>
              <a
                href="/incidents"
                className="mt-1 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium text-brand-400 border border-brand-500/20 hover:bg-brand-500/10 transition-colors"
              >
                Open Incidents <ChevronRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* ── Recent Incidents (full width below) ───────────────────────────── */}
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Recent Incidents</h2>
              <p className="text-[11px] text-text-muted mt-0.5">Latest 8 reports</p>
            </div>
            <a href="/incidents" className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </div>
          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-text-muted animate-pulse">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-5 h-5 text-text-muted" />
              </div>
              <p className="text-sm text-text-secondary">No incidents yet</p>
              <p className="text-xs text-text-muted mt-1">Incidents will appear here as they are reported</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-surface-border">
              <div className="divide-y divide-surface-border">
                {reports.slice(0, Math.ceil(reports.length / 2)).map(r => {
                  const Icon = TYPE_ICON[r.incident_type] ?? HelpCircle
                  const cls = TYPE_COLOR[r.incident_type] ?? 'text-text-muted bg-surface-muted border-surface-border'
                  const sevDot: Record<string, string> = { urgent: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-emerald-500' }
                  return (
                    <button key={r.id} onClick={() => setSelected(r)}
                      className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-surface-muted/40 transition-colors group">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${cls}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sevDot[r.severity] ?? 'bg-surface-muted'}`} />
                          <span className="text-[10px] font-semibold capitalize text-text-muted">{r.severity}</span>
                          <Badge variant="status" value={r.status as any}>{r.status.replace('_', ' ')}</Badge>
                          {r.agency_type && (
                            <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">{r.agency_type}</span>
                          )}
                        </div>
                        <p className="text-sm text-text-primary font-medium truncate leading-snug">{r.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-[11px] text-text-muted min-w-0 truncate">
                            <MapPin className="w-2.5 h-2.5 shrink-0" /> {r.location}
                          </span>
                          <span className="text-[11px] text-text-muted shrink-0 ml-auto">{timeAgo(r.created_at)}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
                    </button>
                  )
                })}
              </div>
              <div className="divide-y divide-surface-border">
                {reports.slice(Math.ceil(reports.length / 2)).map(r => {
                  const Icon = TYPE_ICON[r.incident_type] ?? HelpCircle
                  const cls = TYPE_COLOR[r.incident_type] ?? 'text-text-muted bg-surface-muted border-surface-border'
                  const sevDot: Record<string, string> = { urgent: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-emerald-500' }
                  return (
                    <button key={r.id} onClick={() => setSelected(r)}
                      className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-surface-muted/40 transition-colors group">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${cls}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sevDot[r.severity] ?? 'bg-surface-muted'}`} />
                          <span className="text-[10px] font-semibold capitalize text-text-muted">{r.severity}</span>
                          <Badge variant="status" value={r.status as any}>{r.status.replace('_', ' ')}</Badge>
                          {r.agency_type && (
                            <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">{r.agency_type}</span>
                          )}
                        </div>
                        <p className="text-sm text-text-primary font-medium truncate leading-snug">{r.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="flex items-center gap-0.5 text-[11px] text-text-muted min-w-0 truncate">
                            <MapPin className="w-2.5 h-2.5 shrink-0" /> {r.location}
                          </span>
                          <span className="text-[11px] text-text-muted shrink-0 ml-auto">{timeAgo(r.created_at)}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2" />
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

      </main>

      {selected && <ReportDetailModal report={selected} onClose={() => setSelected(null)} />}
      {kpiModal && <KpiDetailModal />}
    </AppShell>
  )
}
