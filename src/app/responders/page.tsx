'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar }   from '@/components/layout/TopBar'
import {
  UserPlus, X, Eye, EyeOff, Loader2, Shield, MapPin,
  Mail, Lock, User, Building2, Search, Trash2, UserX,
  AlertTriangle, ChevronDown, Copy, Check,
} from 'lucide-react'
import { useAgencySession, isCDRRMO } from '@/hooks/useAgencySession'
import { BARANGAYS, ZONES } from '@/lib/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Agency {
  id:   string
  name: string
  type: string
}

interface Responder {
  id:               string
  first_name:       string
  last_name:        string
  email:            string
  barangay:         string | null
  zone:             string | null
  agency_id:        string | null
  created_at:       string
  active_count?:    number
  responder_status: 'online' | 'on_scene' | 'offline'
  agency?:          Agency | null
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  online:   { label: 'Online',   dot: 'bg-green-500',  badge: 'bg-green-500/10 text-green-400 border-green-500/20'    },
  on_scene: { label: 'On Scene', dot: 'bg-orange-500', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  offline:  { label: 'Offline',  dot: 'bg-surface-muted border border-surface-border', badge: 'bg-surface-muted text-text-muted border-surface-border' },
} as const

// ─── Delete confirm modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  responder,
  onConfirm,
  onCancel,
}: {
  responder: Responder
  onConfirm: () => void
  onCancel:  () => void
}) {
  const hasActive = (responder.active_count ?? 0) > 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6">
          <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-5 h-5 text-violet-400" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary text-center mb-1">
            Remove {responder.first_name} {responder.last_name}?
          </h3>
          <p className="text-xs text-text-muted text-center mb-4">
            This will permanently delete their account and they will no longer be able to log in.
          </p>

          {hasActive && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
              <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400">
                This responder has {responder.active_count} active incident{(responder.active_count ?? 0) !== 1 ? 's' : ''}. Those will become unassigned.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex-1 py-2 rounded-lg text-sm border border-surface-border text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button onClick={onConfirm}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-colors">
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add Responder Modal ──────────────────────────────────────────────────────

function AddResponderModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (r: Responder) => void }) {
  const supabase = createClient()
  const [agencies, setAgencies] = useState<Agency[]>([])

  useEffect(() => {
    supabase.from('agencies').select('id, name, type').order('name').then(({ data }) => { if (data) setAgencies(data) })
  }, [])

  const [form, setForm] = useState({
    first_name: '', last_name: '', middle_initial: '',
    email: '', barangay: '', zone: '', agency_id: '',
  })
  const [tempPassword, setTempPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [copiedPassword, setCopiedPassword] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  // Generate random password
  function generatePassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lowercase = 'abcdefghijklmnopqrstuvwxyz'
    const numbers = '0123456789'
    const special = '!@#$%^&*'
    const allChars = uppercase + lowercase + numbers + special
    
    let pwd = ''
    pwd += uppercase[Math.floor(Math.random() * uppercase.length)]
    pwd += lowercase[Math.floor(Math.random() * lowercase.length)]
    pwd += numbers[Math.floor(Math.random() * numbers.length)]
    pwd += special[Math.floor(Math.random() * special.length)]
    
    for (let i = 0; i < 8; i++) {
      pwd += allChars[Math.floor(Math.random() * allChars.length)]
    }
    
    // Shuffle
    pwd = pwd.split('').sort(() => Math.random() - 0.5).join('')
    setTempPassword(pwd)
    setCopiedPassword(false)
  }

  useEffect(() => {
    generatePassword()
  }, [])

  function copyToClipboard() {
    navigator.clipboard.writeText(tempPassword)
    setCopiedPassword(true)
    setTimeout(() => setCopiedPassword(false), 2000)
  }

  function validate() {
    const errs: Record<string, string> = {}
    if (!form.first_name.trim()) errs.first_name = 'Required'
    if (!form.last_name.trim()) errs.last_name = 'Required'
    if (!form.email.trim()) errs.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email'
    if (!form.barangay) errs.barangay = 'Required'
    if (!form.zone) errs.zone = 'Required'
    if (!form.agency_id) errs.agency_id = 'Required'
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const errs = validate()
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return
    setLoading(true)
    try {
      const { data: existing } = await supabase.from('users').select('id').eq('email', form.email.trim()).maybeSingle()
      if (existing) throw new Error('Email already registered')

      // Call server-side API route — anon key lacks EXECUTE on hash_password()
      const hashRes = await fetch('/api/hash-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: tempPassword }),
      })
      const hashData = await hashRes.json()
      if (!hashRes.ok) throw new Error(hashData.error ?? 'Failed to hash password')
      const hash: string = hashData.hash

      const { data: user, error: insertErr } = await supabase
        .from('users')
        .insert({
          email: form.email.trim().toLowerCase(), password_hash: hash,
          role: 'responder', first_name: form.first_name.trim(), last_name: form.last_name.trim(),
          middle_initial: form.middle_initial.trim() || '', barangay: form.barangay,
          zone: form.zone, agency_id: form.agency_id,
          // Account starts inactive — activated via email link
          verified: false,
        })
        .select().single()
      if (insertErr) throw insertErr

      // ── Send activation email with temp password ─────────────────────────
      const emailRes = await fetch('/api/send-activation-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:       user.id,
          email:        user.email,
          firstName:    form.first_name.trim(),
          tempPassword: tempPassword,
        }),
      })
      const emailData = await emailRes.json()
      if (!emailRes.ok) {
        // Non-fatal: account created but email failed — warn the admin
        console.warn('Activation email failed:', emailData.error)
        setError(`Account created, but email failed: ${emailData.error}. Share the password manually.`)
      }

      const agency = agencies.find(a => a.id === form.agency_id) ?? null
      onSuccess({ ...user, active_count: 0, agency })
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-600/15 border border-brand-600/20 flex items-center justify-center">
              <UserPlus className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Add Responder</h2>
              <p className="text-xs text-text-muted">An activation email with login credentials will be sent to the responder</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm">
              <X className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          {/* Personal Info */}
          <div>
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3">Personal Information</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'First Name', key: 'first_name' as const, placeholder: 'Juan' },
                { label: 'Last Name', key: 'last_name' as const, placeholder: 'Dela Cruz' },
                { label: 'M.I.', key: 'middle_initial' as const, placeholder: 'M' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{f.label}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input type="text" value={form[f.key]} onChange={set(f.key)} placeholder={f.placeholder}
                      maxLength={f.key === 'middle_initial' ? 1 : undefined}
                      className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors ${fieldErrors[f.key] ? 'border-violet-500/60' : 'border-surface-border'}`} />
                  </div>
                  {fieldErrors[f.key] && <p className="text-xs text-violet-400 mt-1">{fieldErrors[f.key]}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Contact & Location */}
          <div>
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3">Contact & Location</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input type="email" value={form.email} onChange={set('email')} placeholder="responder@example.com"
                    className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors ${fieldErrors.email ? 'border-violet-500/60' : 'border-surface-border'}`} />
                </div>
                {fieldErrors.email && <p className="text-xs text-violet-400 mt-1">{fieldErrors.email}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Barangay', key: 'barangay' as const, options: BARANGAYS.map(b => ({ val: b, label: b })), placeholder: 'Select barangay' },
                  { label: 'Zone', key: 'zone' as const, options: ZONES.map(z => ({ val: z, label: z })), placeholder: 'Select zone' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">{f.label}</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                      <select value={form[f.key]} onChange={set(f.key) as any}
                        className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500 transition-colors appearance-none ${fieldErrors[f.key] ? 'border-violet-500/60' : 'border-surface-border'}`}>
                        <option value="">{f.placeholder}</option>
                        {f.options.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                      </select>
                    </div>
                    {fieldErrors[f.key] && <p className="text-xs text-violet-400 mt-1">{fieldErrors[f.key]}</p>}
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">Agency</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                  <select value={form.agency_id} onChange={set('agency_id') as any}
                    className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500 transition-colors appearance-none ${fieldErrors.agency_id ? 'border-violet-500/60' : 'border-surface-border'}`}>
                    <option value="">Select agency</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                  </select>
                </div>
                {fieldErrors.agency_id && <p className="text-xs text-violet-400 mt-1">{fieldErrors.agency_id}</p>}
              </div>
            </div>
          </div>

          {/* Temporary Password */}
          <div>
            <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-3">Temporary Password</h3>
            <div className="bg-surface-muted/60 border border-surface-border rounded-lg p-4 space-y-3">
              <p className="text-xs text-text-muted">
                A temporary password has been generated and will be emailed to the responder along with an activation link. You can also copy it here as a backup.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-3 bg-surface-card border border-surface-border rounded-lg px-4 py-3">
                  <Lock className="w-4 h-4 text-text-muted shrink-0" />
                  <code className="text-sm font-mono text-text-primary select-all">{tempPassword}</code>
                </div>
                <button type="button" onClick={copyToClipboard}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-surface-border hover:bg-surface-muted text-text-secondary hover:text-text-primary transition-colors">
                  {copiedPassword ? (
                    <><Check className="w-4 h-4 text-green-400" /> Copied</>
                  ) : (
                    <><Copy className="w-4 h-4" /> Copy</>
                  )}
                </button>
              </div>
              <button type="button" onClick={generatePassword}
                className="w-full py-2 px-3 text-xs rounded-lg border border-brand-600/30 text-brand-400 hover:bg-brand-600/10 transition-colors">
                Generate New Password
              </button>
            </div>
          </div>
        </form>

        <div className="px-6 py-4 border-t border-surface-border flex items-center justify-end gap-3 bg-surface-muted/30">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-muted border border-surface-border transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit as any} disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><UserPlus className="w-4 h-4" /> Add Responder</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RespondersPage() {
  const supabase = createClient()
  const session  = useAgencySession()

  const [responders, setResponders]   = useState<Responder[]>([])
  const [loading, setLoading]         = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Responder | null>(null)
  const [deleting, setDeleting]       = useState(false)

  // ── Filters ───────────────────────────────────────────────────────────────
  const [search, setSearch]           = useState('')
  const [agencyFilter, setAgencyFilter] = useState<string>('All')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [agencyList, setAgencyList]   = useState<Agency[]>([])

  useEffect(() => {
    fetchResponders()
    supabase.from('agencies').select('id, name, type').order('name').then(({ data }) => { if (data) setAgencyList(data) })

    const channel = supabase
      .channel('responder-live')
      // Fast path: status-only update — patch in place without a full refetch
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, payload => {
        const u = payload.new as Partial<Responder> & { id: string }
        setResponders(prev => {
          const idx = prev.findIndex(r => r.id === u.id)
          if (idx === -1) {
            // New responder appeared (INSERT fired as UPDATE in some Supabase versions) — full refetch
            fetchResponders()
            return prev
          }
          return prev.map(r => r.id === u.id
            ? {
                ...r,
                ...(u.responder_status && { responder_status: u.responder_status }),
                ...(u.first_name && { first_name: u.first_name }),
                ...(u.last_name  && { last_name:  u.last_name  }),
                ...(u.barangay  !== undefined && { barangay:  u.barangay  }),
                ...(u.agency_id !== undefined && { agency_id: u.agency_id }),
              }
            : r
          )
        })
      })
      // New responder added by admin
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'users' }, payload => {
        const u = payload.new as any
        if (u.role !== 'responder') return
        fetchResponders() // need agency join, so full refetch
      })
      // Responder deleted
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'users' }, payload => {
        const u = payload.old as { id: string }
        setResponders(prev => prev.filter(r => r.id !== u.id))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchResponders() {
    setLoading(true)
    let query = supabase
      .from('users')
      .select('id, first_name, last_name, email, barangay, zone, agency_id, created_at, responder_status, agency:agencies(id, name, type)')
      .eq('role', 'responder')
      .order('first_name')

    if (session && !isCDRRMO(session) && session.agencyId) {
      query = query.eq('agency_id', session.agencyId)
    }

    const { data, error } = await query
    if (error) console.error(error)
    if (!data) { setLoading(false); return }

    const withCounts = await Promise.all(data.map(async r => {
      const { count } = await supabase
        .from('incident_reports').select('*', { count: 'exact', head: true })
        .eq('responder_id', r.id).in('status', ['verified', 'responding'])
      return { ...r, active_count: count ?? 0 }
    }))

    setResponders(withCounts)
    setLoading(false)
  }

  async function handleDelete(r: Responder) {
    setDeleting(true)
    await supabase.from('users').delete().eq('id', r.id)
    setResponders(prev => prev.filter(x => x.id !== r.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => responders.filter(r => {
    if (agencyFilter !== 'All' && r.agency_id !== agencyFilter) return false
    if (statusFilter !== 'All' && r.responder_status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !`${r.first_name} ${r.last_name}`.toLowerCase().includes(q) &&
        !r.email.toLowerCase().includes(q) &&
        !(r.barangay ?? '').toLowerCase().includes(q) &&
        !(r.agency as any)?.name?.toLowerCase().includes(q)
      ) return false
    }
    return true
  }), [responders, agencyFilter, statusFilter, search])

  const onlineCount  = responders.filter(r => r.responder_status === 'online').length
  const onSceneCount = responders.filter(r => r.responder_status === 'on_scene').length
  const offlineCount = responders.filter(r => r.responder_status === 'offline').length
  const hasFilters   = search || agencyFilter !== 'All' || statusFilter !== 'All'

  return (
    <AppShell>
      <TopBar title="Responders" subtitle="Agency personnel" />
      <main className="flex-1 p-6 overflow-auto">

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Online',   count: onlineCount,  dot: 'bg-green-500',  text: 'text-green-400'  },
            { label: 'On Scene', count: onSceneCount, dot: 'bg-orange-500', text: 'text-orange-400' },
            { label: 'Offline',  count: offlineCount, dot: 'bg-surface-muted border border-surface-border', text: 'text-text-muted' },
          ].map(s => (
            <div key={s.label} className="glass rounded-xl px-4 py-3 flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
              <span className={`text-xl font-bold ${s.text}`}>{s.count}</span>
              <span className="text-xs text-text-muted">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Search + filters row */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, barangay, agency…"
              className="w-full bg-surface-muted border border-surface-border rounded-lg pl-9 pr-9 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
              </button>
            )}
          </div>

          {/* Agency filter */}
          <div className="flex gap-2 shrink-0 flex-wrap">
            <select
              value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)}
              className="bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-brand-500 transition-colors appearance-none"
            >
              <option value="All">All Agencies</option>
              {agencyList.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-brand-500 transition-colors appearance-none"
            >
              <option value="All">All Statuses</option>
              <option value="online">Online</option>
              <option value="on_scene">On Scene</option>
              <option value="offline">Offline</option>
            </select>

            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setAgencyFilter('All'); setStatusFilter('All') }}
                className="px-3 py-2 rounded-lg text-xs text-brand-400 border border-brand-500/20 hover:bg-brand-500/10 transition-all"
              >
                Clear
              </button>
            )}

            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors shadow-sm"
            >
              <UserPlus className="w-4 h-4" /> Add Responder
            </button>
          </div>
        </div>

        {/* Count line */}
        <p className="text-xs text-text-muted mb-4">
          {hasFilters
            ? `${filtered.length} of ${responders.length} responders`
            : `${responders.length} responder${responders.length !== 1 ? 's' : ''} registered`}
        </p>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading responders…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-xl bg-surface-muted border border-surface-border flex items-center justify-center mx-auto mb-3">
              {hasFilters ? <Search className="w-5 h-5 text-text-muted" /> : <Shield className="w-5 h-5 text-text-muted" />}
            </div>
            <p className="text-sm font-medium text-text-secondary">
              {hasFilters ? 'No responders match your filters' : 'No responders yet'}
            </p>
            {hasFilters
              ? <button onClick={() => { setSearch(''); setAgencyFilter('All'); setStatusFilter('All') }} className="text-xs text-brand-400 mt-2 hover:underline">Clear filters</button>
              : <p className="text-xs text-text-muted mt-1">Click "Add Responder" to create the first one</p>
            }
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(r => {
              const st = STATUS_CONFIG[r.responder_status ?? 'offline']
              return (
                <div key={r.id} className="glass rounded-xl p-5 hover:border-brand-600/20 transition-all group">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center text-brand-400 font-bold text-sm">
                        {r.first_name[0]}{r.last_name[0]}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-card ${st.dot}`} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-text-muted truncate">{r.email}</p>
                      {r.agency && (
                        <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                          {r.agency.type}
                        </span>
                      )}
                      {r.barangay && (
                        <p className="text-xs text-text-secondary mt-0.5">
                          Brgy. {r.barangay}{r.zone ? `, ${r.zone}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Delete button — visible on hover */}
                    <button
                      onClick={() => setDeleteTarget(r)}
                      title="Remove responder"
                      className="w-7 h-7 rounded-lg bg-violet-500/0 border border-transparent text-text-muted opacity-0 group-hover:opacity-100 hover:bg-violet-500/10 hover:border-violet-500/20 hover:text-violet-400 flex items-center justify-center transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="mt-3 pt-3 border-t border-surface-border flex items-center justify-between">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1.5 ${st.badge}`}>
                      {r.responder_status !== 'offline' && (
                        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${r.responder_status === 'on_scene' ? 'bg-orange-400' : 'bg-green-400'}`} />
                      )}
                      {st.label}
                    </span>
                    <span className="text-xs text-text-muted">
                      {r.active_count ?? 0} active incident{(r.active_count ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {showModal && (
        <AddResponderModal
          onClose={() => setShowModal(false)}
          onSuccess={r => { setResponders(prev => [{ ...r, responder_status: 'offline' }, ...prev]); setShowModal(false) }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          responder={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </AppShell>
  )
}
