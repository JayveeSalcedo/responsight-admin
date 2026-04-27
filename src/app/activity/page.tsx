'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar }   from '@/components/layout/TopBar'
import { timeAgo, formatDateTime } from '@/lib/utils'
import {
  Activity, User, Shield, Search, RefreshCw, X,
  FileText, CheckCircle, Star, Building2, Megaphone,
  UserPlus, LogIn, Navigation, MapPin, AlertTriangle,
  ClipboardList, UserCog, Trash2, PenLine, Bell, Settings,
  Clock, ChevronDown, ChevronUp,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActorRole      = 'citizen' | 'responder' | 'admin'
type ActionCategory = 'auth' | 'incident' | 'response' | 'rating' | 'advisory' | 'feedback' | 'admin'

interface LogEntry {
  id:          string
  created_at:  string
  actor_id:    string
  actor_name:  string
  actor_role:  ActorRole
  actor_sub:   string | null   // barangay for citizen, agency type for responder, agency name for admin
  category:    ActionCategory
  action:      string
  description: string
  meta:        Record<string, string | number | null>
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CAT_CFG: Record<ActionCategory, { label: string; color: string; bg: string; border: string }> = {
  auth:     { label: 'Auth',      color: '#a78bfa', bg: 'bg-violet-500/10', border: 'border-violet-500/20'  },
  incident: { label: 'Incident',  color: '#f97316', bg: 'bg-orange-500/10', border: 'border-orange-500/20'  },
  response: { label: 'Response',  color: '#06b6d4', bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20'    },
  rating:   { label: 'Rating',    color: '#eab308', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20'  },
  advisory: { label: 'Advisory',  color: '#3b82f6', bg: 'bg-blue-500/10',   border: 'border-blue-500/20'    },
  feedback: { label: 'Feedback',  color: '#22c55e', bg: 'bg-green-500/10',  border: 'border-green-500/20'   },
  admin:    { label: 'Admin',     color: '#f43f5e', bg: 'bg-rose-500/10',   border: 'border-rose-500/20'    },
}

const ROLE_CFG: Record<ActorRole, { color: string; icon: React.ElementType }> = {
  citizen:   { color: '#38bdf8', icon: User      },
  responder: { color: '#a78bfa', icon: Shield    },
  admin:     { color: '#f43f5e', icon: UserCog   },
}

const ACTION_ICON: Record<string, React.ElementType> = {
  // citizen / auth
  registered:              UserPlus,
  // incident
  submitted_report:        FileText,
  // responder response lifecycle
  accepted_incident:       CheckCircle,
  started_response:        Navigation,
  arrived_at_scene:        MapPin,
  completed_incident:      ClipboardList,
  rejected_incident:       AlertTriangle,
  // rating / feedback
  submitted_rating:        Star,
  submitted_feedback:      Building2,
  // advisory
  advisory_created:        Bell,
  advisory_pushed:         Megaphone,
  advisory_toggled:        PenLine,
  advisory_deleted:        Trash2,
  // admin management
  responder_created:       UserPlus,
  admin_created:           UserCog,
  admin_deleted:           Trash2,
  agency_created:          Building2,
  agency_updated:          Settings,
  agency_deleted:          Trash2,
  // admin incident override
  incident_status_updated: ClipboardList,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sev(s: string | null) {
  if (!s) return null
  const map: Record<string, string> = {
    urgent: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
    high:   'bg-orange-500/15 text-orange-400 border-orange-500/25',
    medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    low:    'bg-green-500/15 text-green-400 border-green-500/25',
  }
  return map[s] ?? 'bg-surface-muted text-text-muted border-surface-border'
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityLogsPage() {
  const supabase = createClient()

  const [logs, setLogs]        = useState<LogEntry[]>([])
  const [loading, setLoading]  = useState(true)
  const [search, setSearch]    = useState('')
  const [roleFilter, setRole]  = useState<ActorRole | null>(null)
  const [catFilter, setCat]    = useState<ActionCategory | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [expanded, setExpanded]= useState<string | null>(null)   // expanded row id

  useEffect(() => {
    fetchLogs()

    // Debounce so bursts of changes (e.g. incident lifecycle) collapse into one rebuild
    let timer: ReturnType<typeof setTimeout>
    function scheduleRefresh() {
      clearTimeout(timer)
      timer = setTimeout(fetchLogs, 1000)
    }

    // Subscribe to every table that produces activity log entries
    const channels = [
      supabase.channel('activity-incidents')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_reports' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-users')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-ratings')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'response_ratings' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-feedback')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agency_feedback' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-advisories')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'advisories' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-agencies')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agencies' }, scheduleRefresh)
        .subscribe(),
      supabase.channel('activity-admins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agency_admins' }, scheduleRefresh)
        .subscribe(),
    ]

    return () => {
      clearTimeout(timer)
      channels.forEach(ch => supabase.removeChannel(ch))
    }
  }, [])

  // ── Data fetching ──────────────────────────────────────────────────────────
  async function fetchLogs() {
    setLoading(true)
    setLastRefresh(new Date())
    try {
      const entries: LogEntry[] = []

      // Fire ALL queries in parallel — previously sequential which caused
      // a multi-second waterfall. Now total time = slowest single query.
      const [
        { data: users },
        { data: reports },
        { data: ratings },
        { data: agFb },
        { data: advisories },
        { data: agAdmins },
        { data: agencies },
        { data: adminOverrides },
      ] = await Promise.all([
        supabase.from('users').select('id, first_name, last_name, role, barangay, agency_id, created_at, agency:agencies(name,type)').in('role', ['citizen', 'responder']).order('created_at', { ascending: false }).limit(300),
        supabase.from('incident_reports').select('id, title, incident_type, severity, status, created_at, accepted_at, responding_started_at, arrived_at, completed_at, updated_at, resolution_notes, rejection_reason, user_id, responder_id, citizen:users!incident_reports_user_id_fkey(first_name, last_name, barangay), responder:users!incident_reports_responder_id_fkey(first_name, last_name, agency:agencies(name,type))').order('created_at', { ascending: false }).limit(300),
        supabase.from('response_ratings').select('id, rating, comment, created_at, citizen_id, citizen:users!response_ratings_citizen_id_fkey(first_name, last_name, barangay)').order('created_at', { ascending: false }).limit(150),
        supabase.from('agency_feedback').select('id, agency, rating, comment, created_at, citizen_id, citizen:users!agency_feedback_citizen_id_fkey(first_name, last_name, barangay)').order('created_at', { ascending: false }).limit(150),
        supabase.from('advisories').select('id, title, severity, is_active, created_at, updated_at, created_by').order('created_at', { ascending: false }).limit(150),
        supabase.from('agency_admins').select('id, first_name, last_name, email, created_at, agency_id, agency:agencies(name,type)').order('created_at', { ascending: false }).limit(100),
        supabase.from('agencies').select('id, name, type, created_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('incident_reports').select('id, title, incident_type, severity, status, updated_at, responder_id, routed_agency_id, agency:agencies!incident_reports_routed_agency_id_fkey(name,type)').in('status', ['verified', 'resolved', 'rejected']).is('responder_id', null).order('updated_at', { ascending: false }).limit(100),
      ])

      // ── 1. Registrations (citizens + responders) ──────────────────────────
      for (const u of users ?? []) {
        const agencyType = (u.agency as any)?.type ?? null
        entries.push({
          id: `reg-${u.id}`, created_at: u.created_at,
          actor_id: u.id,
          actor_name: `${u.first_name} ${u.last_name}`,
          actor_role: u.role as ActorRole,
          actor_sub: u.role === 'citizen' ? u.barangay : agencyType,
          category: 'auth', action: 'registered',
          description: `New ${u.role} account registered`,
          meta: { barangay: u.barangay, agency: agencyType },
        })
      }

      // ── 2. Full incident lifecycle ─────────────────────────────────────────
      for (const r of reports ?? []) {
        const c    = r.citizen  as any
        const resp = r.responder as any

        // 2a — citizen submitted report
        if (c) {
          entries.push({
            id: `rep-${r.id}`, created_at: r.created_at,
            actor_id: r.user_id, actor_name: `${c.first_name} ${c.last_name}`,
            actor_role: 'citizen', actor_sub: c.barangay,
            category: 'incident', action: 'submitted_report',
            description: `Reported "${r.title}"`,
            meta: { type: r.incident_type, severity: r.severity, report_id: r.id },
          })
        }

        if (resp) {
          const rName   = `${resp.first_name} ${resp.last_name}`
          const agType  = resp.agency?.type ?? null

          // 2b — accepted
          if (r.accepted_at) {
            entries.push({
              id: `acc-${r.id}`, created_at: r.accepted_at,
              actor_id: r.responder_id, actor_name: rName,
              actor_role: 'responder', actor_sub: agType,
              category: 'response', action: 'accepted_incident',
              description: `Accepted "${r.title}"`,
              meta: { type: r.incident_type, severity: r.severity, report_id: r.id },
            })
          }

          // 2c — started response (en route)
          if (r.responding_started_at) {
            entries.push({
              id: `enr-${r.id}`, created_at: r.responding_started_at,
              actor_id: r.responder_id, actor_name: rName,
              actor_role: 'responder', actor_sub: agType,
              category: 'response', action: 'started_response',
              description: `En route to "${r.title}"`,
              meta: { type: r.incident_type, severity: r.severity, report_id: r.id },
            })
          }

          // 2d — arrived at scene
          if (r.arrived_at) {
            entries.push({
              id: `arr-${r.id}`, created_at: r.arrived_at,
              actor_id: r.responder_id, actor_name: rName,
              actor_role: 'responder', actor_sub: agType,
              category: 'response', action: 'arrived_at_scene',
              description: `Arrived at scene for "${r.title}"`,
              meta: { type: r.incident_type, severity: r.severity, report_id: r.id },
            })
          }

          // 2e — completed
          if (r.completed_at) {
            entries.push({
              id: `done-${r.id}`, created_at: r.completed_at,
              actor_id: r.responder_id, actor_name: rName,
              actor_role: 'responder', actor_sub: agType,
              category: 'response', action: 'completed_incident',
              description: `Completed "${r.title}"`,
              meta: {
                type: r.incident_type, severity: r.severity,
                notes: r.resolution_notes ?? null, report_id: r.id,
              },
            })
          }
        }

        // 2f — rejected (responder_id may be null for admin overrides)
        if (r.status === 'rejected' && r.rejection_reason) {
          const actor = resp ?? c
          if (actor) {
            entries.push({
              id: `rej-${r.id}`, created_at: r.updated_at,
              actor_id: r.responder_id ?? r.user_id,
              actor_name: resp ? `${resp.first_name} ${resp.last_name}` : `${c?.first_name} ${c?.last_name}`,
              actor_role: resp ? 'responder' : 'citizen',
              actor_sub: resp ? ((resp.agency as any)?.type ?? null) : (c?.barangay ?? null),
              category: 'response', action: 'rejected_incident',
              description: `Rejected "${r.title}"`,
              meta: { reason: r.rejection_reason, severity: r.severity, report_id: r.id },
            })
          }
        }
      }

      // ── 3. Response ratings ───────────────────────────────────────────────
      for (const r of ratings ?? []) {
        const c = r.citizen as any
        if (!c) continue
        entries.push({
          id: `rat-${r.id}`, created_at: r.created_at,
          actor_id: r.citizen_id, actor_name: `${c.first_name} ${c.last_name}`,
          actor_role: 'citizen', actor_sub: c.barangay,
          category: 'rating', action: 'submitted_rating',
          description: `Gave a ${r.rating}-star response rating`,
          meta: { rating: r.rating, comment: r.comment ?? null },
        })
      }

      // ── 4. Agency feedback ────────────────────────────────────────────────
      for (const f of agFb ?? []) {
        const c = f.citizen as any
        if (!c) continue
        entries.push({
          id: `agf-${f.id}`, created_at: f.created_at,
          actor_id: f.citizen_id, actor_name: `${c.first_name} ${c.last_name}`,
          actor_role: 'citizen', actor_sub: c.barangay,
          category: 'feedback', action: 'submitted_feedback',
          description: `Gave ${f.rating}-star feedback for ${f.agency}`,
          meta: { agency: f.agency, rating: f.rating, comment: f.comment ?? null },
        })
      }

      // ── 5. Advisories (admin actions) ─────────────────────────────────────
      // Build advisory creator map from already-fetched agAdmins — no extra query needed
      const advCreatorMap = Object.fromEntries((agAdmins ?? []).map((u: any) => [u.id, u]))

      for (const a of advisories ?? []) {
        const creator  = (a as any).created_by ? advCreatorMap[(a as any).created_by] : null
        const actorName = creator ? `${creator.first_name} ${creator.last_name}` : 'Admin'
        const actorId   = creator?.id ?? 'admin'
        const agName    = (creator?.agency as any)?.name ?? null

        entries.push({
          id: `adv-${a.id}`, created_at: a.created_at,
          actor_id: actorId, actor_name: actorName,
          actor_role: 'admin', actor_sub: agName,
          category: 'advisory', action: 'advisory_created',
          description: `Created advisory "${a.title}"`,
          meta: { severity: a.severity, advisory_id: a.id },
        })
      }

      // ── 6. Responder accounts created by admin ────────────────────────────
      const respUsers = (users ?? []).filter((u: any) => u.role === 'responder')
      for (const u of respUsers) {
        const agType = (u.agency as any)?.type ?? null
        const agName = (u.agency as any)?.name ?? null
        entries.push({
          id: `rcreate-${u.id}`, created_at: u.created_at,
          actor_id: 'admin', actor_name: 'Admin',
          actor_role: 'admin', actor_sub: agName,
          category: 'admin', action: 'responder_created',
          description: `Responder account created for ${u.first_name} ${u.last_name}`,
          meta: { name: `${u.first_name} ${u.last_name}`, agency: agType ?? agName },
        })
      }

      // ── 7. Agency admin accounts created ─────────────────────────────────
      for (const a of agAdmins ?? []) {
        const agName = (a.agency as any)?.name ?? null
        const agType = (a.agency as any)?.type ?? null
        entries.push({
          id: `admincreate-${a.id}`, created_at: a.created_at,
          actor_id: 'admin', actor_name: 'Admin',
          actor_role: 'admin', actor_sub: agName,
          category: 'admin', action: 'admin_created',
          description: `Agency admin created for ${a.first_name} ${a.last_name} (${agType ?? agName})`,
          meta: { name: `${a.first_name} ${a.last_name}`, agency: agType ?? agName, email: a.email },
        })
      }

      // ── 8. Agencies themselves ────────────────────────────────────────────
      for (const a of agencies ?? []) {
        entries.push({
          id: `agcreate-${a.id}`, created_at: a.created_at,
          actor_id: 'admin', actor_name: 'Admin',
          actor_role: 'admin', actor_sub: null,
          category: 'admin', action: 'agency_created',
          description: `Agency "${a.name}" (${a.type}) registered`,
          meta: { agency: a.name, type: a.type },
        })
      }

      // ── 9. Admin incident status overrides ───────────────────────────────
      for (const r of adminOverrides ?? []) {
        const agName = (r.agency as any)?.name ?? null
        entries.push({
          id: `ovr-${r.id}`, created_at: r.updated_at,
          actor_id: 'admin', actor_name: 'Admin',
          actor_role: 'admin', actor_sub: agName,
          category: 'admin', action: 'incident_status_updated',
          description: `Marked "${r.title}" as ${r.status}`,
          meta: { type: r.incident_type, severity: r.severity, status: r.status, report_id: r.id },
        })
      }

      // ── Sort all entries newest first ──────────────────────────────────────
      entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setLogs(entries)
    } catch (e) {
      console.error('fetchLogs error:', e)
    }
    setLoading(false)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => logs.filter(l => {
    if (roleFilter && l.actor_role !== roleFilter) return false
    if (catFilter  && l.category   !== catFilter)  return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !l.actor_name.toLowerCase().includes(q) &&
        !l.description.toLowerCase().includes(q) &&
        !(l.actor_sub ?? '').toLowerCase().includes(q) &&
        !l.action.replace(/_/g, ' ').includes(q)
      ) return false
    }
    return true
  }), [logs, roleFilter, catFilter, search])

  const todayCount   = logs.filter(l => new Date(l.created_at).toDateString() === new Date().toDateString()).length
  const citizenCount = new Set(logs.filter(l => l.actor_role === 'citizen').map(l => l.actor_id)).size
  const respCount    = new Set(logs.filter(l => l.actor_role === 'responder').map(l => l.actor_id)).size
  const adminCount   = logs.filter(l => l.actor_role === 'admin').length

  const catCounts = (Object.keys(CAT_CFG) as ActionCategory[]).reduce(
    (acc, k) => ({ ...acc, [k]: logs.filter(l => l.category === k).length }),
    {} as Record<ActionCategory, number>
  )

  return (
    <AppShell>
      <TopBar title="Activity Logs" subtitle="Complete audit trail — citizens, responders, and admin actions" />
      <main className="flex-1 p-6 space-y-5 overflow-auto">

        {/* ── Summary cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Events',    value: logs.length,  sub: 'all time',          color: 'text-text-primary' },
            { label: 'Today',           value: todayCount,   sub: 'actions logged',    color: 'text-brand-400'    },
            { label: 'Active Citizens', value: citizenCount, sub: 'unique users',      color: 'text-sky-400'      },
            { label: 'Responders',      value: respCount,    sub: 'unique responders', color: 'text-violet-400'   },
          ].map(s => (
            <div key={s.label} className="glass rounded-xl p-4">
              <p className="text-xs text-text-muted mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-text-muted mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Category filter pills ──────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          {(Object.entries(CAT_CFG) as [ActionCategory, (typeof CAT_CFG)[ActionCategory]][]).map(([k, cfg]) => (
            <button
              key={k}
              onClick={() => setCat(catFilter === k ? null : k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${catFilter === k
                  ? `${cfg.bg} ${cfg.border}`
                  : 'border-surface-border text-text-muted hover:text-text-secondary'}`}
              style={catFilter === k ? { color: cfg.color } : {}}
            >
              {cfg.label}
              <span className="opacity-60 tabular-nums">{catCounts[k]}</span>
            </button>
          ))}
        </div>

        {/* ── Search + role filters + controls ──────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, action, barangay, agency…"
              className="w-full bg-surface-muted border border-surface-border rounded-lg pl-9 pr-9 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
              </button>
            )}
          </div>

          <div className="flex gap-2 shrink-0 flex-wrap">
            {/* Role filter buttons */}
            {(['citizen', 'responder', 'admin'] as ActorRole[]).map(r => {
              const cfg = ROLE_CFG[r]
              const I   = cfg.icon
              return (
                <button
                  key={r}
                  onClick={() => setRole(roleFilter === r ? null : r)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border capitalize transition-all
                    ${roleFilter === r ? 'border-opacity-40' : 'border-surface-border text-text-muted hover:text-text-secondary'}`}
                  style={roleFilter === r ? { backgroundColor: `${cfg.color}15`, borderColor: `${cfg.color}40`, color: cfg.color } : {}}
                >
                  <I className="w-3.5 h-3.5" />{r}
                </button>
              )
            })}

            {/* Always-on live indicator */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border bg-green-500/10 border-green-500/20 text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live
            </div>

            {/* Manual refresh */}
            <button
              onClick={fetchLogs} disabled={loading}
              title={`Last updated ${lastRefresh.toLocaleTimeString()}`}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-surface-border text-text-muted hover:text-text-secondary transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Clear filters */}
            {(roleFilter || catFilter || search) && (
              <button
                onClick={() => { setRole(null); setCat(null); setSearch('') }}
                className="px-3 py-2 rounded-lg text-xs text-brand-400 border border-brand-500/20 hover:bg-brand-500/10 transition-all"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Log table ─────────────────────────────────────────────────── */}
        <div className="glass rounded-xl overflow-hidden">

          {/* Header */}
          <div className="hidden md:grid grid-cols-[220px_1fr_110px_100px] gap-4 px-5 py-3 border-b border-surface-border bg-surface-muted/40">
            {['Actor', 'Action', 'Category', 'Time'].map(h => (
              <p key={h} className={`text-[11px] font-semibold text-text-muted uppercase tracking-wider
                ${h === 'Category' ? 'text-center' : h === 'Time' ? 'text-right' : ''}`}>
                {h}
              </p>
            ))}
          </div>

          {loading ? (
            <div className="py-20 text-center text-sm text-text-muted animate-pulse">Loading activity logs…</div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 text-text-muted opacity-20" />
              <p className="text-sm text-text-muted">No activity matches your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border/50">
              {filtered.map(log => {
                const roleCfg  = ROLE_CFG[log.actor_role]
                const catCfg   = CAT_CFG[log.category]
                const RoleIcon = roleCfg.icon
                const ActIcon  = ACTION_ICON[log.action] ?? Activity
                const initials = log.actor_name === 'Admin'
                  ? 'AD'
                  : log.actor_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                const isExpanded = expanded === log.id
                const hasMeta    = Object.values(log.meta).some(v => v !== null && v !== undefined)
                const hasDetail  = log.meta.notes || log.meta.reason || log.meta.comment

                return (
                  <div key={log.id} className="transition-colors hover:bg-surface-muted/20">
                    {/* Main row */}
                    <div
                      className={`grid grid-cols-1 md:grid-cols-[220px_1fr_110px_100px] gap-2 md:gap-4 px-5 py-3.5 ${hasDetail ? 'cursor-pointer' : ''}`}
                      onClick={() => hasDetail && setExpanded(isExpanded ? null : log.id)}
                    >
                      {/* Actor */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-full border shrink-0 flex items-center justify-center text-[11px] font-bold"
                          style={{ backgroundColor: `${roleCfg.color}15`, borderColor: `${roleCfg.color}30`, color: roleCfg.color }}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text-primary truncate">{log.actor_name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <RoleIcon className="w-2.5 h-2.5 shrink-0" style={{ color: roleCfg.color }} />
                            <span className="text-[10px] capitalize" style={{ color: roleCfg.color }}>{log.actor_role}</span>
                            {log.actor_sub && (
                              <span className="text-[10px] text-text-muted truncate">· {log.actor_sub}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action */}
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className="w-7 h-7 rounded-lg shrink-0 mt-0.5 flex items-center justify-center"
                          style={{ backgroundColor: `${catCfg.color}15` }}
                        >
                          <ActIcon className="w-3.5 h-3.5" style={{ color: catCfg.color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-text-primary leading-snug">{log.description}</p>
                            {hasDetail && (
                              isExpanded
                                ? <ChevronUp className="w-3 h-3 text-text-muted shrink-0" />
                                : <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
                            )}
                          </div>
                          {/* Inline tags */}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {log.meta.severity && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${sev(log.meta.severity as string)}`}>
                                {log.meta.severity}
                              </span>
                            )}
                            {log.meta.type && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted border border-surface-border capitalize">
                                {log.meta.type}
                              </span>
                            )}
                            {log.meta.rating && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                {'★'.repeat(Number(log.meta.rating))}
                              </span>
                            )}
                            {log.meta.agency && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {log.meta.agency}
                              </span>
                            )}
                            {log.meta.status && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted border border-surface-border capitalize">
                                → {log.meta.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Category badge */}
                      <div className="flex md:justify-center items-start pt-0.5">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${catCfg.bg} ${catCfg.border}`}
                          style={{ color: catCfg.color }}
                        >
                          {catCfg.label}
                        </span>
                      </div>

                      {/* Time */}
                      <div className="md:text-right">
                        <p className="text-[11px] text-text-muted" title={formatDateTime(log.created_at)}>
                          {timeAgo(log.created_at)}
                        </p>
                        <p className="text-[10px] text-text-muted/60 hidden md:block mt-0.5">
                          {formatDateTime(log.created_at).split(' ').slice(0, 3).join(' ')}
                        </p>
                      </div>
                    </div>

                    {/* Expandable detail row */}
                    {isExpanded && hasDetail && (
                      <div className="px-5 pb-4 ml-[52px] md:ml-[248px] mr-5">
                        <div className="bg-surface-muted/50 border border-surface-border rounded-lg px-4 py-3 text-xs text-text-secondary space-y-1.5">
                          {log.meta.notes && (
                            <div>
                              <span className="text-text-muted font-medium">Resolution notes: </span>
                              {log.meta.notes}
                            </div>
                          )}
                          {log.meta.reason && (
                            <div>
                              <span className="text-text-muted font-medium">Rejection reason: </span>
                              {log.meta.reason}
                            </div>
                          )}
                          {log.meta.comment && (
                            <div>
                              <span className="text-text-muted font-medium">Comment: </span>
                              {log.meta.comment}
                            </div>
                          )}
                          {log.meta.email && (
                            <div>
                              <span className="text-text-muted font-medium">Email: </span>
                              {log.meta.email}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-xs text-text-muted text-right">
          Showing {filtered.length} of {logs.length} events
        </p>

      </main>
    </AppShell>
  )
}
