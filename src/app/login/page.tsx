'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, AlertTriangle, Shield, Radio } from 'lucide-react'
import Image from 'next/image'

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const emailLower = email.trim().toLowerCase()

      // 1. Check both tables in parallel
      const [agencyRes, userRes] = await Promise.all([
        supabase.from('agency_admins').select('id, email, password_hash, first_name, last_name, agency_id').eq('email', emailLower).maybeSingle(),
        supabase.from('users').select('id, email, role, password_hash, first_name, last_name').eq('email', emailLower).maybeSingle()
      ])

      const agencyAdmin = agencyRes.data
      const user = userRes.data
      const account = agencyAdmin ?? user

      if (!account) {
        setError('Invalid email or password')
        setLoading(false)
        return
      }

      // 2. Verify password
      const { data: isValid, error: rpcError } = await supabase
        .rpc('verify_password', {
          password: password,
          password_hash: account.password_hash,
        })

      if (rpcError || !isValid) {
        setError('Invalid email or password')
        setLoading(false)
        return
      }

      // 3. Store session
      localStorage.setItem('rs_user_id', account.id)
      localStorage.setItem('rs_user_email', account.email)
      localStorage.setItem('rs_user_name', `${account.first_name} ${account.last_name}`)
      localStorage.setItem('rs_user_role', agencyAdmin ? 'agency_admin' : (user as any)?.role ?? 'admin')

      if (agencyAdmin?.agency_id) {
        localStorage.setItem('rs_agency_id', agencyAdmin.agency_id)
        // Fetch agency type (we could parallelize this with verify_password, but we need account first)
        const { data: agencyData } = await supabase
          .from('agencies')
          .select('type')
          .eq('id', agencyAdmin.agency_id)
          .single()
        if (agencyData) {
          localStorage.setItem('rs_agency_type', agencyData.type)
        }
      }

      // Set a lightweight auth cookie so middleware can protect routes
      document.cookie = 'rs_authed=1; path=/; SameSite=Lax; max-age=86400'

      router.push('/dashboard')
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
      setLoading(false)
    }
  }

  // Prefetch dashboard to make transition snappier
  useEffect(() => {
    router.prefetch('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — city hall background ─────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[58%] relative overflow-hidden">

        {/* Fallback gradient shown when image is missing */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#0d2142] to-[#091533]" />
        {/* Background image — urdaneta-city-hall.png in /public/images/ */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/urdaneta-city-hall.png')" }}
        />

        {/* Dark overlay for text legibility */}
        <div className="absolute inset-0 bg-black/40" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10" />

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 bg-grid-pattern opacity-10" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">

          {/* Top — logo + system name */}
          <div className="flex items-center gap-3">
            <Image
              src="/images/logonotext.png"
              alt="ResponSight"
              width={40}
              height={40}
              className="object-contain"
              priority
            />
            <div>
              <p className="text-white font-bold text-lg leading-none tracking-tight">ResponSight</p>
              <p className="text-white/50 text-xs">Admin Emergency Reporting & Sentiment Analysis Dashboard</p>
            </div>
          </div>

          {/* Middle — headline */}
          <div className="max-w-md">

            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
              City of Urdaneta<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-brand-300">
                Command Center
              </span>
            </h1>
            <p className="text-white/60 text-sm leading-relaxed">
              A centralized system for tracking public incident reports and analyzing community sentiment to improve emergency response coordination.
            </p>

            {/* Stats row */}
            <div className="flex items-center gap-6 mt-8">
              {[
                { icon: Shield, label: '3 Agencies', sub: 'Connected' },
                { icon: Radio, label: 'Live Dispatch', sub: 'Real-time' },
              ].map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-white text-xs font-semibold">{label}</p>
                    <p className="text-white/40 text-[10px]">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom — city credit */}
          <div>
            <p className="text-white/30 text-xs">
              City Government of Urdaneta · Pangasinan, Philippines
            </p>
          </div>
        </div>
      </div>

      {/* ── Right panel — login form ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-surface px-8 py-12 relative">

        {/* Subtle glow behind form */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-600 rounded-full blur-[140px] opacity-5 pointer-events-none" />

        <div className="relative w-full max-w-sm">

          {/* Mobile logo (hidden on desktop) */}
          <div className="lg:hidden text-center mb-8">
            <Image
              src="/images/logo.png"
              alt="ResponSight"
              width={160}
              height={48}
              className="object-contain mx-auto mb-2"
              priority
            />
            <p className="text-text-secondary text-xs">City of Urdaneta Command Center</p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-text-primary">Welcome back</h2>
            <p className="text-text-secondary text-sm mt-1">Sign in to your agency dashboard</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 mb-5 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@urdaneta.gov.ph"
                className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full bg-surface-card border border-surface-border rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-all mt-2 relative overflow-hidden group"
            >
              <span className={`transition-opacity ${loading ? 'opacity-0' : 'opacity-100'}`}>
                Sign In to Dashboard
              </span>
              {loading && (
                <span className="absolute inset-0 flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Signing in…
                </span>
              )}
            </button>
          </form>

          {/* Agency badges */}
          <div className="mt-8 pt-6 border-t border-surface-border">
            <p className="text-text-muted text-[10px] uppercase tracking-widest text-center mb-3">
              Authorized Agencies
            </p>
            <div className="flex items-center justify-center gap-3">
              {['CDRRMO', 'BFP', 'PNP'].map(agency => (
                <div
                  key={agency}
                  className="px-3 py-1.5 rounded-lg border border-surface-border bg-surface-card text-text-muted text-[10px] font-bold tracking-wider"
                >
                  {agency}
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-text-muted text-[10px] mt-6">
            Authorized personnel only · ResponSight {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  )
}
