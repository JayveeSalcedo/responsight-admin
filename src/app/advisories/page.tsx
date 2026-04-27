'use client'

import { useEffect, useState, useRef } from 'react'
import { AppShell }  from '@/components/layout/AppShell'
import { TopBar }    from '@/components/layout/TopBar'
import { Badge }     from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, timeAgo } from '@/lib/utils'
import { MessageSquare, Send, ChevronDown, ChevronUp, X } from 'lucide-react'

type Severity = 'critical' | 'high' | 'medium' | 'low'

interface Advisory {
  id:         string
  created_at: string
  title:      string
  content:    string
  severity:   Severity
  is_active:  boolean
  expires_at: string | null
}

interface Comment {
  id:         string
  advisory_id: string
  user_id:    string
  text:       string
  created_at: string
  user?: { first_name: string; last_name: string } | null
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export default function AdvisoriesPage() {
  const [advisories,   setAdvisories]   = useState<Advisory[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showModal,    setShowModal]    = useState(false)
  const [pushingId,    setPushingId]    = useState<string | null>(null)
  const [togglingId,   setTogglingId]   = useState<string | null>(null)
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  const supabase = createClient()

  async function fetchAdvisories() {
    const { data, error } = await supabase
      .from('advisories')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setAdvisories(data as Advisory[])
    setLoading(false)
  }

  useEffect(() => {
    fetchAdvisories()
    const channel = supabase
      .channel('advisories_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'advisories' }, fetchAdvisories)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function toggleActive(adv: Advisory) {
    setTogglingId(adv.id)
    const { error } = await supabase.from('advisories').update({ is_active: !adv.is_active }).eq('id', adv.id)
    if (error) showToast('Failed to update advisory', false)
    else       showToast(adv.is_active ? 'Advisory deactivated' : 'Advisory activated')
    setTogglingId(null)
  }

  async function pushNotification(adv: Advisory) {
    setPushingId(adv.id)
    try {
      const res = await supabase.functions.invoke('notify-advisory', {
        body: { advisory_id: adv.id, title: adv.title, content: adv.content, severity: adv.severity },
      })
      if (res.error) throw new Error(res.error.message)
      const count = res.data?.citizens_notified ?? 0
      showToast(`✅ Pushed to ${count} citizen${count !== 1 ? 's' : ''}`)
    } catch (e: any) {
      showToast(`❌ Push failed: ${e.message}`, false)
    } finally {
      setPushingId(null)
    }
  }

  async function deleteAdvisory(id: string) {
    if (!confirm('Delete this advisory?')) return
    await supabase.from('advisories').delete().eq('id', id)
    showToast('Advisory deleted')
  }

  const active = advisories.filter(a => a.is_active)
  const sorted = [...advisories].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return (
    <AppShell>
      <TopBar title="Advisories" subtitle="Push public alerts to all citizens" />

      <main className="flex-1 p-6 overflow-y-auto">
        {/* Header row */}
        <div className="flex justify-between items-center mb-5">
          <p className="text-sm text-text-secondary">
            <span className="text-text-primary font-semibold">{active.length}</span> active &nbsp;·&nbsp;
            <span className="text-text-primary font-semibold">{advisories.length}</span> total
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors"
          >
            + New Advisory
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-text-muted text-sm">Loading…</div>
        ) : advisories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-text-muted text-sm gap-2">
            <span className="text-3xl">📢</span>
            No advisories yet. Create one to alert citizens.
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map(adv => (
              <AdvisoryCard
                key={adv.id}
                adv={adv}
                isExpanded={expandedId === adv.id}
                onToggleExpand={() => setExpandedId(expandedId === adv.id ? null : adv.id)}
                onPush={pushNotification}
                onToggleActive={toggleActive}
                onDelete={deleteAdvisory}
                pushingId={pushingId}
                togglingId={togglingId}
              />
            ))}
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all ${
          toast.ok ? 'bg-green-600 text-white' : 'bg-violet-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {showModal && (
        <CreateAdvisoryModal
          onClose={() => setShowModal(false)}
          onCreated={(pushNow, adv) => { setShowModal(false); if (pushNow) pushNotification(adv) }}
        />
      )}
    </AppShell>
  )
}

// ── Advisory Card with inline comments ───────────────────────────────────────

function AdvisoryCard({
  adv, isExpanded, onToggleExpand,
  onPush, onToggleActive, onDelete,
  pushingId, togglingId,
}: {
  adv:            Advisory
  isExpanded:     boolean
  onToggleExpand: () => void
  onPush:         (adv: Advisory) => void
  onToggleActive: (adv: Advisory) => void
  onDelete:       (id: string)    => void
  pushingId:      string | null
  togglingId:     string | null
}) {
  const supabase = createClient()

  const [comments,   setComments]   = useState<Comment[]>([])
  const [commentCount, setCount]    = useState<number | null>(null)
  const [loadingC,   setLoadingC]   = useState(false)
  const [input,      setInput]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [postError,  setPostError]  = useState<string | null>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)  // ref so closures always see latest value

  // Fetch count on mount for the badge
  useEffect(() => {
    supabase
      .from('advisory_comments')
      .select('id', { count: 'exact', head: true })
      .eq('advisory_id', adv.id)
      .then(({ count }) => setCount(count ?? 0))
  }, [adv.id])

  // Load comments + subscribe when expanded
  useEffect(() => {
    if (!isExpanded) return

    setLoadingC(true)
    fetchComments()

    const channel = supabase
      .channel(`advisory_comments_${adv.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'advisory_comments',
        filter: `advisory_id=eq.${adv.id}`,
      }, () => fetchComments())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [isExpanded, adv.id])

  async function fetchComments() {
    const { data } = await supabase
      .from('advisory_comments')
      .select('*, user:users!advisory_comments_user_id_fkey(first_name, last_name)')
      .eq('advisory_id', adv.id)
      .order('created_at', { ascending: true })

    if (data) {
      setComments(data as Comment[])
      setCount(data.length)
    }
    setLoadingC(false)
  }

  async function postComment() {
    const text = input.trim()
    if (!text || sendingRef.current) return

    // Admin session is stored in localStorage by the login page
    const adminId    = localStorage.getItem('rs_user_id')
    const adminEmail = localStorage.getItem('rs_user_email')
    if (!adminId) { setPostError('Not logged in'); return }

    // advisory_comments.user_id FK points to users table.
    // Agency admins are in agency_admins, not users — look up by id in users first,
    // then fall back to agency_admins id directly (FK may be relaxed or cross-table).
    const { data: userRow } = await supabase
      .from('users')
      .select('id')
      .eq('id', adminId)
      .maybeSingle()

    const userId = userRow?.id ?? adminId

    sendingRef.current = true
    setSending(true)
    setPostError(null)
    setInput('')

    // Build comment payload — user_id is null for admin replies
    // agency_type + agency_name are stored so mobile can render the admin badge
    const agencyType = localStorage.getItem('rs_agency_type')
    const agencyName = localStorage.getItem('rs_user_name')
    const insertPayload: any = {
      advisory_id:  adv.id,
      text,
      agency_type:  agencyType ?? null,
      agency_name:  agencyName ?? null,
    }
    if (userRow?.id) insertPayload.user_id = userRow.id

    const { error } = await supabase
      .from('advisory_comments')
      .insert(insertPayload)

    if (error) {
      console.error('Comment insert error:', error)
      setPostError(error.message)
      setInput(text)
      sendingRef.current = false
      setSending(false)
      return
    }

    // Notify all citizens who previously commented on this advisory (except the admin)
    try {
      const { data: prevComments } = await supabase
        .from('advisory_comments')
        .select('user_id, user:users!advisory_comments_user_id_fkey(id, role)')
        .eq('advisory_id', adv.id)
        .neq('user_id', userId)   // exclude the admin who just replied

      // Unique citizen IDs only
      const citizenIds = [
        ...new Set(
          (prevComments ?? [])
            .filter((c: any) => c.user?.role === 'citizen')
            .map((c: any) => c.user_id as string)
        )
      ]

      for (const citizenId of citizenIds) {
        await supabase.functions.invoke('send-notification', {
          body: {
            userId:   citizenId,
            title:    `Admin replied on: ${adv.title}`,
            message:  text.length > 80 ? text.slice(0, 80) + '…' : text,
            data: {
              type:        'advisory_reply',
              advisory_id: adv.id,
            },
          },
        })
      }
    } catch (notifErr) {
      // Non-fatal — comment was posted, just log the notification failure
      console.warn('Advisory reply notification failed:', notifErr)
    }

    sendingRef.current = false
    setSending(false)
  }

  // Scroll to bottom when comments load/update
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [comments, isExpanded])

  return (
    <div className={`glass rounded-xl transition-opacity ${adv.is_active ? 'border-l-2 border-l-brand-500' : 'opacity-50'}`}>
      {/* Main advisory row */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="severity" value={adv.severity}>{adv.severity}</Badge>
              {adv.is_active
                ? <span className="text-[10px] font-bold text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full">ACTIVE</span>
                : <span className="text-[10px] font-bold text-text-muted bg-surface-muted border border-surface-border px-2 py-0.5 rounded-full">INACTIVE</span>
              }
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">{adv.title}</h3>
            <p className="text-xs text-text-secondary leading-relaxed">{adv.content}</p>
            <p className="text-[11px] text-text-muted mt-2">{formatDateTime(adv.created_at)}</p>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => onPush(adv)}
              disabled={pushingId === adv.id || !adv.is_active}
              title={!adv.is_active ? 'Activate advisory first' : 'Send push to all citizens'}
              className="px-3 py-1.5 text-xs rounded-lg bg-brand-600/15 border border-brand-600/30 text-brand-400 hover:bg-brand-600/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {pushingId === adv.id
                ? <><span className="w-3 h-3 border border-brand-400 border-t-transparent rounded-full animate-spin" /> Pushing…</>
                : <>🔔 Push</>
              }
            </button>
            <button
              onClick={() => onToggleActive(adv)}
              disabled={togglingId === adv.id}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-muted border border-surface-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
            >
              {togglingId === adv.id ? '…' : adv.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={() => onDelete(adv.id)}
              className="px-3 py-1.5 text-xs rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Comment toggle footer */}
        <div className="mt-4 pt-3 border-t border-surface-border">
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors group"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="font-medium">
              {commentCount === null ? 'Comments' : commentCount === 0 ? 'No comments yet' : `${commentCount} comment${commentCount !== 1 ? 's' : ''}`}
            </span>
            {isExpanded
              ? <ChevronUp className="w-3.5 h-3.5 ml-1 text-text-muted group-hover:text-text-primary transition-colors" />
              : <ChevronDown className="w-3.5 h-3.5 ml-1 text-text-muted group-hover:text-text-primary transition-colors" />
            }
          </button>
        </div>
      </div>

      {/* Comments panel */}
      {isExpanded && (
        <div className="border-t border-surface-border">
          {/* Comment list */}
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto px-5 py-4 space-y-4"
          >
            {loadingC ? (
              <div className="flex justify-center py-6">
                <span className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-text-muted">
                <MessageSquare className="w-7 h-7 opacity-40" />
                <p className="text-xs">No comments yet — citizens can comment from the app</p>
              </div>
            ) : (
              comments.map(c => {
                const adminName = localStorage.getItem('rs_user_name') ?? 'Admin'
                const name = c.user ? `${c.user.first_name} ${c.user.last_name}` : adminName
                const isAdmin = !c.user
                const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <div key={c.id} className={`flex items-start gap-3 ${isAdmin ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      isAdmin
                        ? 'bg-brand-600/20 border border-brand-600/30 text-brand-400'
                        : 'bg-surface-muted border border-surface-border text-text-muted'
                    }`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`flex items-baseline gap-2 mb-1 ${isAdmin ? 'flex-row-reverse' : ''}`}>
                        <span className="text-xs font-semibold text-text-primary">{name}</span>
                        {isAdmin && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-600/15 border border-brand-600/20 text-brand-400 uppercase tracking-wide">
                            {localStorage.getItem('rs_agency_type') ?? 'Admin'}
                          </span>
                        )}
                        <span className="text-[10px] text-text-muted">{timeAgo(c.created_at)}</span>
                      </div>
                      <div className={`border rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        isAdmin
                          ? 'bg-brand-600/10 border-brand-600/20 text-text-primary rounded-tr-none ml-auto'
                          : 'bg-surface-muted border-surface-border text-text-secondary rounded-tl-none'
                      }`}>
                        {c.text}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Reply input */}
          <div className="px-5 pb-4 pt-2 border-t border-surface-border">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-surface-muted border border-surface-border rounded-lg px-3 py-2 focus-within:border-brand-500 transition-colors">
                <input
                  value={input}
                  onChange={e => { setInput(e.target.value); setPostError(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.stopPropagation()
                      postComment()
                    }
                  }}
                  placeholder="Reply as admin…"
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                />
              </div>
              <button
                onClick={postComment}
                disabled={!input.trim() || sending}
                className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center hover:bg-brand-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {sending
                  ? <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
            {postError
              ? <p className="text-[10px] text-violet-400 mt-1.5 ml-1">Error: {postError}</p>
              : <p className="text-[10px] text-text-muted mt-1.5 ml-1">Press Enter to send · Citizens see admin replies in the app</p>
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create Advisory Modal ─────────────────────────────────────────────────────

function CreateAdvisoryModal({
  onClose,
  onCreated,
}: {
  onClose:   () => void
  onCreated: (pushNow: boolean, adv: Advisory) => void
}) {
  const supabase = createClient()

  const [title,    setTitle]    = useState('')
  const [content,  setContent]  = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [pushNow,  setPushNow]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleCreate() {
    if (!title.trim() || !content.trim()) { setError('Title and content are required'); return }
    setSaving(true); setError('')

    const agencyId = localStorage.getItem('rs_agency_id')

    const { data, error: err } = await supabase
      .from('advisories')
      .insert({
        title:     title.trim(),
        content:   content.trim(),
        severity,
        is_active: true,
        ...(agencyId ? { agency_id: agencyId } : {}),
      })
      .select().single()

    if (err) { setError(err.message); setSaving(false); return }
    onCreated(pushNow, data as Advisory)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-text-primary">New Advisory</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-secondary mb-1.5 block">Title *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Flash Flood Warning – Abra River"
              className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary mb-1.5 block">Severity *</label>
            <div className="flex gap-2">
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map(s => (
                <button key={s} onClick={() => setSeverity(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border capitalize transition-colors ${
                    severity === s
                      ? s === 'critical' ? 'bg-violet-500/20 border-violet-500/50 text-violet-400'
                        : s === 'high'   ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                        : s === 'medium' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
                        :                  'bg-green-500/20 border-green-500/50 text-green-400'
                      : 'bg-surface-muted border-surface-border text-text-muted hover:text-text-primary'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary mb-1.5 block">Content *</label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)} rows={4}
              placeholder="Describe the advisory and any instructions for citizens..."
              className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-500 transition-colors resize-none"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => setPushNow(p => !p)}
              className={`w-10 h-5 rounded-full transition-colors relative ${pushNow ? 'bg-brand-500' : 'bg-surface-muted border border-surface-border'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${pushNow ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-text-secondary">Send push notification to all citizens now</span>
          </label>

          {error && <p className="text-xs text-violet-400">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm border border-surface-border text-text-secondary hover:text-text-primary transition-colors">Cancel</button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-500 transition-colors disabled:opacity-50">
            {saving ? 'Creating…' : pushNow ? 'Create & Push' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
