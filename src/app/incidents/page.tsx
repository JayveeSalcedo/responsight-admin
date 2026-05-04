'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { AppShell }  from '@/components/layout/AppShell'
import { TopBar }    from '@/components/layout/TopBar'
import { Badge }     from '@/components/ui/Badge'
import {
  MapPin, Clock, List, Map, Filter, X,
  Navigation, AlertTriangle, RefreshCw, Radio,
  User, Shield, ChevronDown, ChevronRight,
  Flame, Waves, Car, Stethoscope, ShieldAlert, HelpCircle,
  Camera, ImageOff,
} from 'lucide-react'
import { useAgencySession, agencyFilter } from '@/hooks/useAgencySession'
import { timeAgo, formatDateTime } from '@/lib/utils'
import type { MapReport } from '@/components/map/IncidentMap'
import type { ResponderLocation, MapIncident } from '@/app/map/page'

// ─── Dynamic map imports ──────────────────────────────────────────────────────

const IncidentMap = dynamic(() => import('@/components/map/IncidentMap'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-surface text-text-muted text-sm">Loading map...</div>,
})
const LiveDispatchMap = dynamic(() => import('@/components/map/LiveDispatchMap'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-surface text-text-muted text-sm gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading map…</div>,
})

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES   = ['All', 'pending', 'verified', 'responding', 'resolved', 'rejected']
const SEVERITIES = ['All', 'urgent', 'high', 'medium', 'low']
type ViewMode    = 'list' | 'map' | 'dispatch'

const TYPE_ICON: Record<string, React.ElementType> = {
  fire: Flame, flood: Waves, accident: Car, medical: Stethoscope, crime: ShieldAlert,
}
const TYPE_COLOR: Record<string, string> = {
  fire:     'text-orange-400 bg-orange-500/10 border-orange-500/20',
  flood:    'text-blue-400   bg-blue-500/10   border-blue-500/20',
  accident: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  medical:  'text-green-400  bg-green-500/10  border-green-500/20',
  crime:    'text-violet-400    bg-violet-500/10    border-violet-500/20',
}

// ─── Extended report type (for detail modal) ──────────────────────────────────

interface FullReport extends MapReport {
  description:      string | null
  resolution_notes: string | null
  rejection_reason: string | null
  accepted_at:      string | null
  arrived_at:       string | null
  completed_at:     string | null
}

interface ReportMedia {
  media_url:  string
  media_type: string
  uploader:   'citizen' | 'responder' | 'unknown'
}

// ─── Status update dropdown (click-triggered) ─────────────────────────────────

function StatusDropdown({ reportId, current, onUpdate }: {
  reportId: string
  current:  string
  onUpdate: (id: string, status: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const options = ['verified', 'responding', 'resolved', 'rejected'].filter(s => s !== current)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors px-2 py-1 rounded border border-brand-500/20 hover:bg-brand-500/10"
      >
        Update <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 glass rounded-lg overflow-hidden z-50 shadow-xl border border-surface-border">
          {options.map(s => (
            <button
              key={s}
              onClick={e => { e.stopPropagation(); onUpdate(reportId, s); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary capitalize transition-colors"
            >
              → {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Incident detail modal ────────────────────────────────────────────────────

function IncidentDetailModal({
  reportId,
  onClose,
  onStatusUpdate,
}: {
  reportId:       string
  onClose:        () => void
  onStatusUpdate: (id: string, status: string) => void
}) {
  const supabase = createClient()
  const [report,  setReport]  = useState<FullReport | null>(null)
  const [media,   setMedia]   = useState<ReportMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null)

  useEffect(() => {
    async function load() {
      const [reportRes, mediaRes] = await Promise.all([
        supabase
          .from('incident_reports')
          .select(`
            id, incident_type, title, description, location, status, severity,
            created_at, accepted_at, arrived_at, completed_at, resolution_notes, rejection_reason,
            latitude, longitude,
            agency:agencies!incident_reports_routed_agency_id_fkey(name, type),
            reporter:users!incident_reports_user_id_fkey(first_name, last_name),
            responder:users!incident_reports_responder_id_fkey(first_name, last_name)
          `)
          .eq('id', reportId)
          .single(),
        supabase
          .from('report_media')
          .select('media_url, media_type')
          .eq('report_id', reportId)
          .order('created_at', { ascending: true }),
      ])

      if (!reportRes.error && reportRes.data) {
        const d = reportRes.data as any
        setReport({
          ...d,
          agency_name:    d.agency?.name   ?? null,
          agency_type:    d.agency?.type   ?? null,
          reporter_name:  d.reporter  ? `${d.reporter.first_name} ${d.reporter.last_name}`   : null,
          responder_name: d.responder ? `${d.responder.first_name} ${d.responder.last_name}` : null,
        })
      }

      if (mediaRes.data) {
        setMedia((mediaRes.data as any[]).map(m => {
          const url: string = m.media_url
          const uploader: ReportMedia['uploader'] =
            url.includes('/responder/') ? 'responder' :
            url.includes('/citizen/')   ? 'citizen'   : 'unknown'
          return { media_url: url, media_type: m.media_type, uploader }
        }))
      }

      setLoading(false)
    }
    load()
  }, [reportId])

  const sevStrip = !report ? 'bg-surface-muted' :
    report.severity === 'urgent' ? 'bg-violet-500' :
    report.severity === 'high'   ? 'bg-orange-500' :
    report.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">

        <div className={`h-1 w-full ${sevStrip}`} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-surface-border">
          <div className="flex-1 min-w-0">
            {report && (
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <Badge variant="severity" value={report.severity as any}>{report.severity}</Badge>
                <Badge variant="status"   value={report.status   as any}>{report.status.replace('_', ' ')}</Badge>
                {report.agency_type && (
                  <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                    {report.agency_type}
                  </span>
                )}
              </div>
            )}
            <h2 className="text-sm font-semibold text-text-primary leading-snug">
              {loading ? 'Loading…' : report?.title ?? 'Incident Details'}
            </h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center transition-colors shrink-0">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-text-muted animate-pulse">Loading incident details…</div>
          ) : !report ? (
            <div className="py-12 text-center text-sm text-text-muted">Failed to load report</div>
          ) : (
            <>
              {/* Type chip */}
              {(() => {
                const Icon = TYPE_ICON[report.incident_type] ?? HelpCircle
                const cls  = TYPE_COLOR[report.incident_type] ?? 'text-text-muted bg-surface-muted border-surface-border'
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

              {/* Location + reported time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-muted border border-surface-border rounded-lg p-3">
                  <p className="text-[10px] text-text-muted font-medium mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</p>
                  <p className="text-xs text-text-primary leading-snug">{report.location}</p>
                </div>
                <div className="bg-surface-muted border border-surface-border rounded-lg p-3">
                  <p className="text-[10px] text-text-muted font-medium mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Reported</p>
                  <p className="text-xs text-text-primary">{formatDateTime(report.created_at)}</p>
                </div>
              </div>

              {/* Timeline */}
              {(report.accepted_at || report.arrived_at || report.completed_at) && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">Timeline</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Reported',  ts: report.created_at,   color: 'bg-brand-500' },
                      { label: 'Accepted',  ts: report.accepted_at,  color: 'bg-cyan-500'  },
                      { label: 'Arrived',   ts: report.arrived_at,   color: 'bg-yellow-500'},
                      { label: 'Completed', ts: report.completed_at, color: 'bg-green-500' },
                    ].filter(t => t.ts).map(t => (
                      <div key={t.label} className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${t.color}`} />
                        <span className="text-[11px] text-text-muted w-20 shrink-0">{t.label}</span>
                        <span className="text-[11px] text-text-primary">{formatDateTime(t.ts!)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                      <p className="text-[10px] text-text-muted">Assigned responder</p>
                      <p className="text-xs font-semibold text-text-primary">{report.responder_name}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-surface-muted border border-surface-border opacity-50">
                    <div className="w-7 h-7 rounded-full bg-surface-muted border border-surface-border flex items-center justify-center shrink-0">
                      <Shield className="w-3.5 h-3.5 text-text-muted" />
                    </div>
                    <p className="text-xs text-text-muted italic">No responder assigned</p>
                  </div>
                )}
              </div>

              {/* Photos */}
              {(loading || media.length > 0) && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5" /> Photos
                    {media.length > 0 && <span className="text-brand-400 normal-case font-normal">({media.length})</span>}
                  </p>
                  {loading ? (
                    <div className="flex gap-2">
                      {[1,2,3].map(i => <div key={i} className="w-20 h-20 rounded-lg bg-surface-muted animate-pulse" />)}
                    </div>
                  ) : media.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-text-muted py-3">
                      <ImageOff className="w-4 h-4" /> No photos submitted
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(['citizen', 'responder'] as const).map(party => {
                        const group = media.filter(m => m.uploader === party)
                        if (!group.length) return null
                        const allUrls = media.map(m => m.media_url)
                        return (
                          <div key={party}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1"
                              style={{ color: party === 'responder' ? '#a78bfa' : '#38bdf8' }}>
                              {party === 'responder' ? '🚨' : '👤'} {party === 'citizen' ? 'Reported by citizen' : 'Uploaded by responder'}
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {group.map((m, i) => {
                                const globalIdx = allUrls.indexOf(m.media_url)
                                return (
                                  <button
                                    key={m.media_url}
                                    onClick={() => setLightbox({ urls: allUrls, idx: globalIdx })}
                                    className="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-border hover:border-brand-500/50 transition-all group shrink-0"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={m.media_url}
                                      alt={`Photo ${i + 1}`}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                      <span className="opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold">View</span>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Resolution notes */}
              {report.resolution_notes && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Resolution Notes</p>
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-text-primary leading-relaxed">{report.resolution_notes}</p>
                  </div>
                </div>
              )}

              {/* Rejection reason */}
              {report.rejection_reason && (
                <div>
                  <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Rejection Reason</p>
                  <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-text-primary leading-relaxed">{report.rejection_reason}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Lightbox */}
        {lightbox && (
          <div className="fixed inset-0 z-[950] bg-black/95 flex items-center justify-center" onClick={() => setLightbox(null)}>
            <button className="absolute top-4 right-4 text-white/60 hover:text-white z-10" onClick={() => setLightbox(null)}>
              <X className="w-6 h-6" />
            </button>
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white z-10 p-2 disabled:opacity-20"
              disabled={lightbox.idx === 0}
              onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l) }}
            >
              <ChevronDown className="w-7 h-7 rotate-90" />
            </button>
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white z-10 p-2 disabled:opacity-20"
              disabled={lightbox.idx === lightbox.urls.length - 1}
              onClick={e => { e.stopPropagation(); setLightbox(l => l && l.idx < l.urls.length - 1 ? { ...l, idx: l.idx + 1 } : l) }}
            >
              <ChevronDown className="w-7 h-7 -rotate-90" />
            </button>
            <div className="relative max-w-3xl max-h-[85vh] px-16" onClick={e => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.urls[lightbox.idx]}
                alt="Full size"
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/50 text-xs">
                {lightbox.idx + 1} / {lightbox.urls.length}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        {report && (
          <div className="px-6 py-3 border-t border-surface-border flex items-center justify-between">
            <div className="flex gap-1.5 flex-wrap">
              {['verified', 'responding', 'resolved', 'rejected']
                .filter(s => s !== report.status)
                .map(s => (
                  <button
                    key={s}
                    onClick={() => { onStatusUpdate(report.id, s); onClose() }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium capitalize bg-surface-muted border border-surface-border text-text-secondary hover:text-text-primary hover:border-brand-600/30 transition-colors"
                  >
                    → {s}
                  </button>
                ))}
            </div>
            <span className="text-[11px] text-text-muted">{timeAgo(report.created_at)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const supabase = createClient()
  const session  = useAgencySession()

  const [reports, setReports]           = useState<MapReport[]>([])
  const [loading, setLoading]           = useState(true)
  const [view, setView]                 = useState<ViewMode>('map')
  const [statusFilter, setStatus]       = useState('All')
  const [severityFilter, setSeverity]   = useState('All')
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [detailId, setDetailId]         = useState<string | null>(null)
  const [showFilters, setShowFilters]   = useState(false)

  // ── Pagination (list view only) ───────────────────────────────────────────
  const PAGE_SIZE = 15
  const [page,       setPage]       = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  // dispatch
  const [responders,      setResponders]      = useState<ResponderLocation[]>([])
  const [liveIncidents,   setLiveIncidents]   = useState<MapIncident[]>([])
  const [selectedR,       setSelectedR]       = useState<string | null>(null)
  const [selectedI,       setSelectedI]       = useState<string | null>(null)
  const [lastUpdate,      setLastUpdate]      = useState<Date>(new Date())
  const [dispatchLoading, setDispatchLoading] = useState(false)

  // ── Fetch reports (map/dispatch view — no pagination, coords only) ────────
  const fetchMapReports = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('incident_reports')
      .select(`
        id, incident_type, title, location, status, severity, created_at, latitude, longitude,
        routed_agency_id,
        agency:agencies!incident_reports_routed_agency_id_fkey(name, type),
        reporter:users!incident_reports_user_id_fkey(first_name, last_name),
        responder:users!incident_reports_responder_id_fkey(first_name, last_name)
      `)
      .order('created_at', { ascending: false })
      .limit(500)
    if (statusFilter   !== 'All') query = query.eq('status',   statusFilter)
    if (severityFilter !== 'All') query = query.eq('severity', severityFilter)
    const filter = agencyFilter(session)
    if (filter) query = query.eq('routed_agency_id', filter)
    const { data, error } = await query
    if (error) console.error(error)
    if (data) {
      setReports(data.map((r: any) => ({
        id: r.id, incident_type: r.incident_type, title: r.title,
        location: r.location, status: r.status, severity: r.severity,
        created_at: r.created_at, latitude: r.latitude, longitude: r.longitude,
        agency_name: r.agency?.name ?? null, agency_type: r.agency?.type ?? null,
        reporter_name:  r.reporter  ? `${r.reporter.first_name} ${r.reporter.last_name}`  : null,
        responder_name: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : null,
      })))
    }
    setLoading(false)
  }, [statusFilter, severityFilter, session])

  // ── Fetch reports (list view — paginated from Supabase) ───────────────────
  const fetchListReports = useCallback(async (targetPage: number) => {
    setLoading(true)
    const from = (targetPage - 1) * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    let query = supabase
      .from('incident_reports')
      .select(`
        id, incident_type, title, location, status, severity, created_at, latitude, longitude,
        routed_agency_id,
        agency:agencies!incident_reports_routed_agency_id_fkey(name, type),
        reporter:users!incident_reports_user_id_fkey(first_name, last_name),
        responder:users!incident_reports_responder_id_fkey(first_name, last_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
    if (statusFilter   !== 'All') query = query.eq('status',   statusFilter)
    if (severityFilter !== 'All') query = query.eq('severity', severityFilter)
    const filter = agencyFilter(session)
    if (filter) query = query.eq('routed_agency_id', filter)

    const { data, count, error } = await query
    if (error) console.error(error)
    if (data) {
      setReports(data.map((r: any) => ({
        id: r.id, incident_type: r.incident_type, title: r.title,
        location: r.location, status: r.status, severity: r.severity,
        created_at: r.created_at, latitude: r.latitude, longitude: r.longitude,
        agency_name: r.agency?.name ?? null, agency_type: r.agency?.type ?? null,
        reporter_name:  r.reporter  ? `${r.reporter.first_name} ${r.reporter.last_name}`  : null,
        responder_name: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : null,
      })))
    }
    if (count !== null) setTotalCount(count)
    setLoading(false)
  }, [statusFilter, severityFilter, session])

  // ── Wire up fetching per view ─────────────────────────────────────────────
  useEffect(() => {
    if (view === 'list') {
      fetchListReports(page)
    } else {
      fetchMapReports()
    }
  }, [view, page, fetchListReports, fetchMapReports])

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [statusFilter, severityFilter])

  // Realtime: on any change, refresh the current view
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>
    function handleChange() {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (view === 'list') fetchListReports(page)
        else fetchMapReports()
      }, 800)
    }
    const ch = supabase
      .channel('incidents-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_reports' }, handleChange)
      .subscribe()
    return () => { clearTimeout(debounceTimer); supabase.removeChannel(ch) }
  }, [view, page, fetchListReports, fetchMapReports])

  // ── Dispatch ──────────────────────────────────────────────────────────────

  const fetchResponders = useCallback(async () => {
    const { data, error } = await supabase
      .from('responder_locations')
      .select(`
        responder_id, latitude, longitude, heading, speed, updated_at,
        responder:users!responder_locations_responder_id_fkey(first_name, last_name, responder_status)
      `)

    if (error) console.error('[fetchResponders]', error)

    setResponders(
      (data ?? [])
        .filter((r: any) => r.responder)
        .map((r: any) => ({
          responder_id:     r.responder_id,
          latitude:         r.latitude,
          longitude:        r.longitude,
          heading:          r.heading,
          speed:            r.speed,
          updated_at:       r.updated_at,
          first_name:       r.responder.first_name,
          last_name:        r.responder.last_name,
          responder_status: r.responder.status ?? 'online',
        }))
        .filter((r: ResponderLocation) => r.responder_status !== 'offline')
    )
    setLastUpdate(new Date())
  }, [])

  const fetchLiveIncidents = useCallback(async () => {
    const { data } = await supabase
      .from('incident_reports')
      .select(`id, title, incident_type, location, status, severity, created_at, latitude, longitude,
        responder:users!incident_reports_responder_id_fkey(first_name, last_name)`)
      .in('status', ['pending', 'verified', 'responding'])
      .not('latitude', 'is', null).not('longitude', 'is', null)
      .order('created_at', { ascending: false })
    setLiveIncidents(
      (data ?? []).map((r: any) => ({
        id: r.id, title: r.title, incident_type: r.incident_type, location: r.location,
        status: r.status, severity: r.severity, created_at: r.created_at,
        latitude: r.latitude, longitude: r.longitude,
        responder_name: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : null,
      }))
    )
  }, [])

  useEffect(() => {
    if (view !== 'dispatch') return
    const init = async () => { setDispatchLoading(true); await Promise.all([fetchResponders(), fetchLiveIncidents()]); setDispatchLoading(false) }
    init()
    const ch1 = supabase.channel('dispatch-loc').on('postgres_changes', { event: '*', schema: 'public', table: 'responder_locations' }, fetchResponders).subscribe()
    const ch2 = supabase.channel('dispatch-usr').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, fetchResponders).subscribe()
    const ch3 = supabase.channel('dispatch-inc').on('postgres_changes', { event: '*', schema: 'public', table: 'incident_reports' }, fetchLiveIncidents).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3) }
  }, [view, fetchResponders, fetchLiveIncidents])

  async function updateStatus(id: string, status: string) {
    await supabase.from('incident_reports').update({ status }).eq('id', id)
    if (view === 'list') fetchListReports(page)
    else fetchMapReports()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const selected      = reports.find(r => r.id === selectedId) ?? null
  const mappable      = reports.filter(r => r.latitude && r.longitude)
  const unmappable    = reports.filter(r => !r.latitude || !r.longitude)
  const activeCount   = reports.filter(r => ['pending', 'verified', 'responding'].includes(r.status)).length
  const onlineCount   = responders.filter(r => r.responder_status === 'online').length
  const onSceneCount  = responders.filter(r => r.responder_status === 'on_scene').length
  const secsSince     = Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
  const selResponder  = responders.find(r => r.responder_id === selectedR) ?? null
  const selIncident   = liveIncidents.find(i => i.id === selectedI) ?? null

  return (
    <AppShell>
      <TopBar title="Incidents" subtitle={
        view === 'list'
          ? `${totalCount} total · page ${page} of ${totalPages}`
          : `${reports.length} reports · ${activeCount} active · ${mappable.length} on map`
      } />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">

        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-border bg-surface-card/60 flex-wrap shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-surface-border">
            {([['map', Map, 'Map'], ['list', List, 'List'], ['dispatch', Radio, 'Live Dispatch']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v as ViewMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${view === v ? 'bg-brand-600/20 text-brand-400' : 'text-text-secondary hover:bg-surface-muted'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
                {v === 'dispatch' && <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
              </button>
            ))}
          </div>

          {view !== 'dispatch' && (
            <>
              <button onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${showFilters ? 'bg-brand-600/15 text-brand-400 border-brand-600/30' : 'border-surface-border text-text-secondary hover:border-brand-600/30'}`}>
                <Filter className="w-3.5 h-3.5" /> Filters
                {(statusFilter !== 'All' || severityFilter !== 'All') && <span className="w-1.5 h-1.5 bg-brand-500 rounded-full" />}
              </button>
              {showFilters && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">Status:</span>
                  {STATUSES.map(s => (
                    <button key={s} onClick={() => setStatus(s)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize border transition-colors ${statusFilter === s ? 'bg-brand-600/15 text-brand-400 border-brand-600/30' : 'bg-surface-muted text-text-secondary border-surface-border hover:border-brand-600/30'}`}>
                      {s}
                    </button>
                  ))}
                  <span className="text-[10px] text-text-muted uppercase tracking-wider ml-2">Severity:</span>
                  {SEVERITIES.map(s => (
                    <button key={s} onClick={() => setSeverity(s)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize border transition-colors ${severityFilter === s ? 'bg-brand-600/15 text-brand-400 border-brand-600/30' : 'bg-surface-muted text-text-secondary border-surface-border hover:border-brand-600/30'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {loading && view !== 'dispatch' && <span className="ml-auto text-xs text-text-muted animate-pulse">Updating...</span>}
        </div>

        {/* ── MAP VIEW ──────────────────────────────────────────────────── */}
        {view === 'map' && (
          // FIX: min-h-0 prevents the flex row from growing taller than the
          // available viewport space when the incident list gets long.
          <div className="flex-1 flex overflow-hidden min-h-0">

            {/* Incident list panel — scrolls internally, never pushes the map */}
            <div className="w-80 border-r border-surface-border flex flex-col bg-surface-card shrink-0 min-h-0">
              <div className="px-4 py-3 border-b border-surface-border shrink-0">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {mappable.length} plotted · {unmappable.length} without coords
                </p>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-surface-border min-h-0">
                {reports.map(r => (
                  <button key={r.id}
                    onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                    className={`w-full text-left px-4 py-3 transition-all hover:bg-surface-muted/60 ${selectedId === r.id ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="severity" value={r.severity as any}>{r.severity}</Badge>
                      <Badge variant="status"   value={r.status   as any}>{r.status.replace('_', ' ')}</Badge>
                      {(!r.latitude || !r.longitude) && <span className="text-[9px] text-text-muted border border-surface-border rounded px-1 ml-auto">no coords</span>}
                    </div>
                    <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2">{r.title}</p>
                    <span className="flex items-center gap-0.5 text-[10px] text-text-muted mt-1"><MapPin className="w-2.5 h-2.5" />{r.location}</span>
                    <span className="text-[10px] text-text-muted">{timeAgo(r.created_at)}</span>
                  </button>
                ))}
                {!loading && reports.length === 0 && <div className="px-4 py-8 text-center text-xs text-text-muted">No incidents found</div>}
              </div>
            </div>

            {/* Map panel — fills remaining space, locked to viewport height */}
            <div className="flex-1 relative min-h-0">
              <IncidentMap reports={mappable} selectedId={selectedId} onSelectReport={r => setSelectedId(r.id === selectedId ? null : r.id)} />
              {selected && (
                <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 glass rounded-xl p-4 shadow-2xl z-[1000]">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="severity" value={selected.severity as any}>{selected.severity}</Badge>
                        <Badge variant="status"   value={selected.status   as any}>{selected.status.replace('_', ' ')}</Badge>
                      </div>
                      <h3 className="text-sm font-semibold text-text-primary leading-snug">{selected.title}</h3>
                    </div>
                    <button onClick={() => setSelectedId(null)}><X className="w-4 h-4 text-text-muted hover:text-text-primary" /></button>
                  </div>
                  <div className="space-y-1 text-xs text-text-secondary mb-3">
                    <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" />{selected.location}</div>
                    <div className="flex items-center gap-1.5"><Clock className="w-3 h-3 shrink-0" />{timeAgo(selected.created_at)}</div>
                    {selected.reporter_name  && <div>👤 {selected.reporter_name}</div>}
                    {selected.responder_name ? <div>🚨 {selected.responder_name}</div> : <div className="text-text-muted italic">Unassigned</div>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-1.5 flex-wrap">
                      {['verified','responding','resolved','rejected'].filter(s => s !== selected.status).map(s => (
                        <button key={s} onClick={() => updateStatus(selected.id, s)}
                          className="px-2.5 py-1 rounded-md text-[11px] font-medium capitalize bg-surface-muted border border-surface-border text-text-secondary hover:text-text-primary hover:border-brand-600/30 transition-colors">
                          → {s}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setDetailId(selected.id)}
                      className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 shrink-0">
                      Details <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              <div className="absolute top-3 right-3 glass rounded-lg p-3 z-[999] text-[10px] space-y-1.5">
                <p className="text-text-muted font-semibold uppercase tracking-wider mb-2">Severity</p>
                {[['urgent','#ef4444'],['high','#f97316'],['medium','#eab308'],['low','#22c55e']].map(([l,c]) => (
                  <div key={l} className="flex items-center gap-2 capitalize text-text-secondary">
                    <span style={{ background: c }} className="w-2.5 h-2.5 rounded-full shrink-0" />{l}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── LIST VIEW ─────────────────────────────────────────────────── */}
        {view === 'list' && (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Cards */}
            <div className="flex-1 overflow-auto p-4 min-h-0">
              {loading ? (
                <div className="py-12 text-center text-sm text-text-muted animate-pulse">Loading...</div>
              ) : reports.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">No incidents found</div>
              ) : (
                <div className="space-y-2">
                  {reports.map(r => {
                    const Icon = TYPE_ICON[r.incident_type] ?? HelpCircle
                    const cls  = TYPE_COLOR[r.incident_type] ?? 'text-text-muted bg-surface-muted border-surface-border'
                    return (
                      <div
                        key={r.id}
                        onClick={() => setDetailId(r.id)}
                        className="glass rounded-xl px-4 py-3 cursor-pointer hover:border-brand-500/30 transition-all"
                      >
                        {/* Row 1: type chip + badges + time + actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium shrink-0 ${cls}`}>
                            <Icon className="w-3 h-3" />
                            <span className="capitalize">{r.incident_type}</span>
                          </div>
                          <Badge variant="severity" value={r.severity as any}>{r.severity}</Badge>
                          <Badge variant="status"   value={r.status   as any}>{r.status.replace('_', ' ')}</Badge>
                          {r.agency_type && (
                            <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                              {r.agency_type}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1 text-[11px] text-text-muted shrink-0">
                            <Clock className="w-3 h-3" />{timeAgo(r.created_at)}
                          </span>
                          <div onClick={e => e.stopPropagation()}>
                            <StatusDropdown reportId={r.id} current={r.status} onUpdate={updateStatus} />
                          </div>
                        </div>
                        {/* Row 2: title */}
                        <p className="text-sm font-semibold text-text-primary mt-1.5 leading-snug line-clamp-1">{r.title}</p>
                        {/* Row 3: location + people */}
                        <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-text-muted">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />{r.location}
                          </span>
                          {r.reporter_name && <span>👤 {r.reporter_name}</span>}
                          {r.responder_name
                            ? <span>🚨 {r.responder_name}</span>
                            : <span className="italic">Unassigned</span>
                          }
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border bg-surface-card/60 shrink-0">
                <span className="text-xs text-text-muted">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-text-secondary hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ←
                  </button>
                  {(() => {
                    const delta = 2
                    const range: (number | '...')[] = []
                    let prev = 0
                    for (let i = 1; i <= totalPages; i++) {
                      if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
                        if (prev && i - prev > 1) range.push('...')
                        range.push(i)
                        prev = i
                      }
                    }
                    return range.map((item, idx) =>
                      item === '...' ? (
                        <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-text-muted">…</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setPage(item as number)}
                          className={`min-w-[30px] px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            page === item
                              ? 'bg-brand-600/20 text-brand-400 border-brand-500/40'
                              : 'border-surface-border text-text-secondary hover:bg-surface-muted'
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )
                  })()}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-text-secondary hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE DISPATCH VIEW ────────────────────────────────────────── */}
        {view === 'dispatch' && (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-72 border-r border-surface-border flex flex-col bg-surface-card shrink-0 min-h-0">
              <div className="px-4 py-3 border-b border-surface-border space-y-2 shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Responders</span>
                  <span className="text-[10px] text-text-muted">Updated {secsSince}s ago</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                    <span className="text-sm font-bold text-cyan-400">{onlineCount}</span>
                    <span className="text-[10px] text-text-muted">Online</span>
                  </div>
                  <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                    <span className="text-sm font-bold text-violet-400">{onSceneCount}</span>
                    <span className="text-[10px] text-text-muted">On Scene</span>
                  </div>
                </div>
              </div>

              <div className="px-3 py-2 border-b border-surface-border shrink-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Navigation className="w-3 h-3" /> Active Responders
                </p>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-surface-border min-h-0">
                {responders.length === 0 && !dispatchLoading && (
                  <div className="px-4 py-6 text-center text-xs text-text-muted">No responders online</div>
                )}
                {responders.map(r => {
                  const isOnScene = r.responder_status === 'on_scene'
                  const staleSecs = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 1000)
                  return (
                    <button key={r.responder_id}
                      onClick={() => { setSelectedR(r.responder_id === selectedR ? null : r.responder_id); setSelectedI(null) }}
                      className={`w-full text-left px-4 py-3 transition-all hover:bg-surface-muted/60 ${selectedR === r.responder_id ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}>
                      <div className="flex items-center gap-2.5">
                        <div className="relative shrink-0">
                          <div className="w-8 h-8 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center text-brand-400 font-bold text-xs">
                            {r.first_name[0]}{r.last_name[0]}
                          </div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-card ${isOnScene ? 'bg-violet-500' : 'bg-cyan-500'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary truncate">{r.first_name} {r.last_name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`text-[10px] font-medium ${isOnScene ? 'text-violet-400' : 'text-cyan-400'}`}>{isOnScene ? 'On Scene' : 'Online'}</span>
                            {r.speed != null && r.speed > 1 && <span className="text-[10px] text-text-muted">· {Math.round(r.speed)} km/h</span>}
                          </div>
                        </div>
                        <span className={`text-[9px] ${staleSecs > 30 ? 'text-violet-400' : 'text-text-muted'}`}>
                          {staleSecs < 60 ? `${staleSecs}s` : `${Math.floor(staleSecs / 60)}m`}
                        </span>
                      </div>
                    </button>
                  )
                })}

                <div className="px-3 py-2 bg-surface-muted/40 shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" /> Open Incidents ({liveIncidents.length})
                  </p>
                </div>

                {liveIncidents.map(inc => (
                  <button key={inc.id}
                    onClick={() => { setSelectedI(inc.id === selectedI ? null : inc.id); setSelectedR(null) }}
                    className={`w-full text-left px-4 py-3 transition-all hover:bg-surface-muted/60 ${selectedI === inc.id ? 'bg-brand-600/10 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="severity" value={inc.severity as any}>{inc.severity}</Badge>
                      <Badge variant="status"   value={inc.status   as any}>{inc.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-1">{inc.title}</p>
                    <p className="text-[10px] text-text-muted mt-0.5 truncate">{inc.location}</p>
                  </button>
                ))}

                {liveIncidents.length === 0 && !dispatchLoading && (
                  <div className="px-4 py-4 text-center text-xs text-text-muted">No active incidents</div>
                )}
              </div>
            </div>

            <div className="flex-1 relative min-h-0">
              {dispatchLoading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-surface text-text-muted text-sm gap-2 z-10">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : (
                <LiveDispatchMap
                  responders={responders} incidents={liveIncidents}
                  selectedResponderId={selectedR} selectedIncidentId={selectedI}
                  onSelectResponder={id => { setSelectedR(id); setSelectedI(null) }}
                  onSelectIncident={id  => { setSelectedI(id); setSelectedR(null) }}
                />
              )}

              {selResponder && (
                <div className="absolute bottom-4 left-4 glass rounded-xl p-4 shadow-2xl z-[1000] w-64">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-text-primary">{selResponder.first_name} {selResponder.last_name}</p>
                    <button onClick={() => setSelectedR(null)}><X className="w-4 h-4 text-text-muted hover:text-text-primary" /></button>
                  </div>
                  <div className="space-y-1 text-[11px] text-text-secondary">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${selResponder.responder_status === 'on_scene' ? 'bg-violet-500' : 'bg-cyan-500'}`} />
                      {selResponder.responder_status === 'on_scene' ? 'On Scene' : 'Online'}
                    </div>
                    {selResponder.speed != null && (
                      <div className="flex items-center gap-1.5"><Navigation className="w-3 h-3" />{Math.round(selResponder.speed)} km/h{selResponder.heading != null && ` · ${Math.round(selResponder.heading)}°`}</div>
                    )}
                    <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />Last update: {timeAgo(selResponder.updated_at)}</div>
                  </div>
                </div>
              )}

              {selIncident && (
                <div className="absolute bottom-4 left-4 glass rounded-xl p-4 shadow-2xl z-[1000] w-72">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="severity" value={selIncident.severity as any}>{selIncident.severity}</Badge>
                        <Badge variant="status"   value={selIncident.status   as any}>{selIncident.status.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-xs font-bold text-text-primary leading-snug">{selIncident.title}</p>
                    </div>
                    <button onClick={() => setSelectedI(null)}><X className="w-4 h-4 text-text-muted hover:text-text-primary shrink-0" /></button>
                  </div>
                  <div className="space-y-1 text-[11px] text-text-secondary">
                    <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 shrink-0" />{selIncident.location}</div>
                    <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" />{timeAgo(selIncident.created_at)}</div>
                    {selIncident.responder_name ? <div>🚨 {selIncident.responder_name}</div> : <div className="text-text-muted italic">Unassigned</div>}
                  </div>
                  <button onClick={() => setDetailId(selIncident.id)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300">
                    View details <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="absolute top-3 right-3 glass rounded-lg p-3 z-[999] text-[10px] space-y-2 min-w-[120px]">
                <p className="text-text-muted font-semibold uppercase tracking-wider">Legend</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-text-secondary"><span className="w-3 h-3 rounded-full bg-cyan-500 shrink-0" />Online</div>
                  <div className="flex items-center gap-2 text-text-secondary"><span className="w-3 h-3 rounded-full bg-violet-500 shrink-0" />On Scene</div>
                </div>
                <div className="border-t border-surface-border pt-2 space-y-1.5">
                  {[['urgent','#ef4444'],['high','#f97316'],['medium','#eab308'],['low','#22c55e']].map(([l,c]) => (
                    <div key={l} className="flex items-center gap-2 text-text-secondary capitalize">
                      <span style={{ background: c }} className="w-2.5 h-2.5 rounded-full shrink-0" />{l}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {detailId && (
        <IncidentDetailModal
          reportId={detailId}
          onClose={() => setDetailId(null)}
          onStatusUpdate={(id, status) => { updateStatus(id, status); setDetailId(null) }}
        />
      )}
    </AppShell>
  )
}
