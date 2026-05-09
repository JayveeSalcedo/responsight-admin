'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar }   from '@/components/layout/TopBar'
import {
  Shield, Users, Bell, Globe,
  ChevronRight, ArrowLeft, Plus, Trash2,
  Loader2, X, Eye, EyeOff, User, Mail, Lock, Building2, Check,
} from 'lucide-react'

type Section = 'menu' | 'agency' | 'admins'

interface Agency {
  id:   string
  name: string
  type: string
}

interface AgencyAdmin {
  id:         string
  agency_id:  string
  first_name: string
  last_name:  string
  email:      string
  created_at: string
}

const AGENCY_TYPES = ['CDRRMO', 'BFP', 'PNP', 'NDRRMC']

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionHeader({ title, desc, onBack }: { title: string; desc: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button
        onClick={onBack}
        className="w-8 h-8 rounded-lg hover:bg-surface-muted border border-surface-border flex items-center justify-center transition-colors"
      >
        <ArrowLeft className="w-4 h-4 text-text-muted" />
      </button>
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted">{desc}</p>
      </div>
    </div>
  )
}

// ── Agency Profile Section ────────────────────────────────────────────────────

function AgencyProfileSection({ onBack }: { onBack: () => void }) {
  const supabase = createClient()

  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // Edit state
  const [editId,   setEditId]   = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('')

  // Create state
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('CDRRMO')

  useEffect(() => {
    fetchAgencies()
  }, [])

  async function fetchAgencies() {
    // Load agencies for list + edit selectors.
    setLoading(true)
    const { data } = await supabase.from('agencies').select('*').order('created_at')
    if (data) setAgencies(data)
    setLoading(false)
  }

  function startEdit(a: Agency) {
    setEditId(a.id)
    setEditName(a.name)
    setEditType(a.type)
    setError(null)
    setSuccess(false)
  }

  async function saveEdit() {
    if (!editName.trim()) { setError('Agency name is required'); return }
    setSaving(true); setError(null)

    const { error: err } = await supabase
      .from('agencies')
      .update({ name: editName.trim(), type: editType })
      .eq('id', editId!)

    if (err) { setError(err.message) }
    else {
      setAgencies(prev => prev.map(a => a.id === editId ? { ...a, name: editName.trim(), type: editType } : a))
      setEditId(null)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    }
    setSaving(false)
  }

  async function createAgency() {
    if (!newName.trim()) { setError('Agency name is required'); return }
    setSaving(true); setError(null)

    const { data, error: err } = await supabase
      .from('agencies')
      .insert({ name: newName.trim(), type: newType })
      .select().single()

    if (err) { setError(err.message) }
    else {
      setAgencies(prev => [...prev, data])
      setNewName(''); setShowCreate(false)
    }
    setSaving(false)
  }

  async function deleteAgency(id: string) {
    if (!confirm('Delete this agency? This will also remove all linked admin accounts.')) return
    await supabase.from('agencies').delete().eq('id', id)
    setAgencies(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div className="max-w-xl">
      <SectionHeader title="Agency Profile" desc="Manage your registered agencies" onBack={onBack} />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-text-muted" /></div>
      ) : (
        <div className="space-y-3">
          {agencies.map(a => (
            <div key={a.id} className="glass rounded-xl p-4">
              {editId === a.id ? (
                // ── Edit form ──
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-text-secondary mb-1.5 block">Agency Name</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full bg-surface-muted border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-secondary mb-1.5 block">Agency Type</label>
                    <div className="flex gap-2">
                      {AGENCY_TYPES.map(t => (
                        <button
                          key={t}
                          onClick={() => setEditType(t)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                            editType === t
                              ? 'bg-brand-600/20 border-brand-600/40 text-brand-400'
                              : 'bg-surface-muted border-surface-border text-text-muted hover:text-text-primary'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {error && <p className="text-xs text-violet-400">{error}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setEditId(null)}
                      className="flex-1 py-2 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                // ── Display row ──
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{a.name}</p>
                    <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                      {a.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => startEdit(a)}
                      className="px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary hover:border-brand-600/30 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteAgency(a.id)}
                      className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 flex items-center justify-center transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Create new agency */}
          {showCreate ? (
            <div className="glass rounded-xl p-4 space-y-3 border-brand-600/20">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Agency Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Urdaneta CDRRMO"
                    className="w-full bg-surface-muted border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Agency Type</label>
                <div className="flex gap-2">
                  {AGENCY_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setNewType(t)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        newType === t
                          ? 'bg-brand-600/20 border-brand-600/40 text-brand-400'
                          : 'bg-surface-muted border-surface-border text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-xs text-violet-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowCreate(false); setError(null) }}
                  className="flex-1 py-2 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createAgency}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Create
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setShowCreate(true); setError(null) }}
              className="w-full py-3 rounded-xl border border-dashed border-surface-border text-xs text-text-muted hover:text-text-secondary hover:border-brand-600/30 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" /> Add Agency
            </button>
          )}

          {success && (
            <p className="text-xs text-green-400 flex items-center gap-1.5">
              <Check className="w-3 h-3" /> Saved successfully
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Agency Admins Section ─────────────────────────────────────────────────────

function AgencyAdminsSection({ onBack }: { onBack: () => void }) {
  const supabase = createClient()

  const [agencies, setAgencies] = useState<Agency[]>([])
  const [admins,   setAdmins]   = useState<AgencyAdmin[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Form
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '',
    password: '', confirm: '', agency_id: '',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showPw, setShowPw] = useState(false)
  const [showCf, setShowCf] = useState(false)
  const [saving,  setSaving]  = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: ag }, { data: adm }] = await Promise.all([
      supabase.from('agencies').select('*').order('name'),
      supabase.from('agency_admins').select('*').order('created_at', { ascending: false }),
    ])
    if (ag)  setAgencies(ag)
    if (adm) setAdmins(adm)
    setLoading(false)
  }

  function validate() {
    const errs: Record<string, string> = {}
    if (!form.first_name.trim()) errs.first_name = 'Required'
    if (!form.last_name.trim())  errs.last_name  = 'Required'
    if (!form.email.trim())      errs.email      = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email'
    if (!form.agency_id)         errs.agency_id  = 'Required'
    if (!form.password)          errs.password   = 'Required'
    else if (form.password.length < 8) errs.password = 'Min 8 characters'
    else if (!/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/.test(form.password)) errs.password = 'Needs uppercase, lowercase & number'
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match'
    return errs
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const errs = validate()
    setFieldErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    try {
      // Check email not already taken
      const { data: existing } = await supabase
        .from('agency_admins').select('id').eq('email', form.email.trim()).maybeSingle()
      if (existing) throw new Error('Email already registered')

      // Hash password with same RPC as mobile
      const { data: hash, error: hashErr } = await supabase
        .rpc('hash_password', { password: form.password })
      if (hashErr) throw hashErr

      const { data, error: insertErr } = await supabase
        .from('agency_admins')
        .insert({
          first_name:    form.first_name.trim(),
          last_name:     form.last_name.trim(),
          email:         form.email.trim().toLowerCase(),
          password_hash: hash,
          agency_id:     form.agency_id,
        })
        .select().single()

      if (insertErr) throw insertErr

      setAdmins(prev => [data, ...prev])
      setForm({ first_name: '', last_name: '', email: '', password: '', confirm: '', agency_id: '' })
      setShowForm(false)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAdmin(id: string) {
    if (!confirm('Remove this admin account?')) return
    await supabase.from('agency_admins').delete().eq('id', id)
    setAdmins(prev => prev.filter(a => a.id !== id))
  }

  const agencyName = (id: string) => agencies.find(a => a.id === id)?.name ?? '—'
  const agencyType = (id: string) => agencies.find(a => a.id === id)?.type ?? ''

  return (
    <div className="max-w-xl">
      <SectionHeader title="Admin Accounts" desc="Agency staff who can log into this dashboard" onBack={onBack} />

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-text-muted" /></div>
      ) : (
        <div className="space-y-3">
          {/* Admin list */}
          {admins.length === 0 && !showForm && (
            <div className="text-center py-10 text-text-muted">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No admin accounts yet</p>
            </div>
          )}

          {admins.map(a => (
            <div key={a.id} className="glass rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center text-brand-400 font-bold text-xs shrink-0">
                {a.first_name[0]}{a.last_name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {a.first_name} {a.last_name}
                </p>
                <p className="text-xs text-text-muted truncate">{a.email}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-bold text-brand-400 bg-brand-600/10 border border-brand-600/20 px-1.5 py-0.5 rounded">
                    {agencyType(a.agency_id)}
                  </span>
                  <span className="text-[10px] text-text-muted">{agencyName(a.agency_id)}</span>
                </div>
              </div>
              <button
                onClick={() => deleteAdmin(a.id)}
                className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 flex items-center justify-center transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {/* Create form */}
          {showForm ? (
            <div className="glass rounded-xl p-5 border-brand-600/20 space-y-4">
              <p className="text-xs font-semibold text-text-primary">New Admin Account</p>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs">
                  <X className="w-3.5 h-3.5 shrink-0" />{error}
                </div>
              )}

              {/* Agency */}
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Agency *</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                  <select
                    value={form.agency_id} onChange={set('agency_id')}
                    className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-brand-500 transition-colors appearance-none ${fieldErrors.agency_id ? 'border-violet-500/60' : 'border-surface-border'}`}
                  >
                    <option value="">Select agency</option>
                    {agencies.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                  </select>
                </div>
                {fieldErrors.agency_id && <p className="text-xs text-violet-400 mt-1">{fieldErrors.agency_id}</p>}
              </div>

              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'First Name', key: 'first_name' as const, placeholder: 'Juan' },
                  { label: 'Last Name',  key: 'last_name'  as const, placeholder: 'Dela Cruz' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label} *</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        value={form[key]} onChange={set(key)} placeholder={placeholder}
                        className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors ${fieldErrors[key] ? 'border-violet-500/60' : 'border-surface-border'}`}
                      />
                    </div>
                    {fieldErrors[key] && <p className="text-xs text-violet-400 mt-1">{fieldErrors[key]}</p>}
                  </div>
                ))}
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1.5 block">Email *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="email" value={form.email} onChange={set('email')} placeholder="admin@agency.gov.ph"
                    className={`w-full bg-surface-muted border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors ${fieldErrors.email ? 'border-violet-500/60' : 'border-surface-border'}`}
                  />
                </div>
                {fieldErrors.email && <p className="text-xs text-violet-400 mt-1">{fieldErrors.email}</p>}
              </div>

              {/* Password */}
              {[
                { label: 'Password',         key: 'password' as const, show: showPw, toggle: () => setShowPw(v => !v), placeholder: 'Min. 8 characters' },
                { label: 'Confirm Password', key: 'confirm'  as const, show: showCf, toggle: () => setShowCf(v => !v), placeholder: 'Re-enter password'  },
              ].map(({ label, key, show, toggle, placeholder }) => (
                <div key={key}>
                  <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label} *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type={show ? 'text' : 'password'} value={form[key]} onChange={set(key)} placeholder={placeholder}
                      className={`w-full bg-surface-muted border rounded-lg pl-9 pr-10 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors ${fieldErrors[key] ? 'border-violet-500/60' : 'border-surface-border'}`}
                    />
                    <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors[key]
                    ? <p className="text-xs text-violet-400 mt-1">{fieldErrors[key]}</p>
                    : key === 'password' && <p className="text-xs text-text-muted mt-1">Uppercase, lowercase &amp; number required</p>
                  }
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowForm(false); setError(null); setFieldErrors({}) }}
                  className="flex-1 py-2 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Create Admin
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-3 rounded-xl border border-dashed border-surface-border text-xs text-text-muted hover:text-text-secondary hover:border-brand-600/30 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" /> Add Admin Account
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Settings Page ────────────────────────────────────────────────────────

const MENU_ITEMS = [
  { id: 'agency', icon: Shield,   title: 'Agency Profile',  desc: 'Manage agencies (CDRRMO, BFP, PNP)' },
  { id: 'admins', icon: Users,    title: 'Admin Accounts',  desc: 'Create and manage dashboard admins'  },
  { id: 'notifs', icon: Bell,     title: 'Notifications',   desc: 'Alert thresholds and push settings'  },
  { id: 'integr', icon: Globe,    title: 'Integrations',    desc: 'Supabase, API keys, webhooks'        },
] as const

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('menu')

  return (
    <AppShell>
      <TopBar title="Settings" subtitle="Agency configuration" />
      <main className="flex-1 p-6 overflow-y-auto">

        {section === 'menu' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            {MENU_ITEMS.map(({ id, icon: Icon, title, desc }) => (
              <button
                key={id}
                onClick={() => (id === 'agency' || id === 'admins') && setSection(id as Section)}
                className={`glass rounded-xl p-5 text-left transition-all group ${
                  id === 'agency' || id === 'admins'
                    ? 'hover:border-brand-600/30 cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-brand-600/10 border border-brand-600/20 flex items-center justify-center mb-3 group-hover:bg-brand-600/20 transition-colors">
                    <Icon className="w-5 h-5 text-brand-400" />
                  </div>
                  {(id === 'agency' || id === 'admins') && (
                    <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors mt-1" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                <p className="text-xs text-text-muted mt-0.5">{desc}</p>
                {(id === 'notifs' || id === 'integr') && (
                  <span className="text-[10px] text-text-muted border border-surface-border rounded px-1.5 py-0.5 mt-2 inline-block">Coming soon</span>
                )}
              </button>
            ))}
          </div>
        )}

        {section === 'agency' && <AgencyProfileSection onBack={() => setSection('menu')} />}
        {section === 'admins' && <AgencyAdminsSection  onBack={() => setSection('menu')} />}

      </main>
    </AppShell>
  )
}
