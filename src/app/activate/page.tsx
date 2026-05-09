'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react'

type State = 'loading' | 'success' | 'expired' | 'already' | 'error'

function ActivateContent() {
  const params = useSearchParams()
  const router = useRouter()
  const token  = params.get('token') ?? ''

  const [state, setState] = useState<State>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) { setState('error'); setMessage('No activation token provided.'); return }

    // Verify token via API and surface the result state.
    fetch('/api/activate-account', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.alreadyActive) return setState('already')
        if (data.expired)       return setState('expired')
        if (data.success)       return setState('success')
        setMessage(data.error ?? 'Activation failed.')
        setState('error')
      })
      .catch(() => { setState('error'); setMessage('Network error.') })
  }, [token])

  const config: Record<State, { icon: React.ReactNode; title: string; body: string; accent: string }> = {
    loading: {
      icon:   <Loader2 className="w-10 h-10 animate-spin text-brand-400" />,
      title:  'Activating your account…',
      body:   'Please wait while we verify your token.',
      accent: 'text-brand-400',
    },
    success: {
      icon:   <CheckCircle className="w-10 h-10 text-green-400" />,
      title:  'Account Activated!',
      body:   'Your responder account is now active. Open the ResponSight mobile app and log in with the credentials that were emailed to you. Remember to change your password in Security Settings.',
      accent: 'text-green-400',
    },
    already: {
      icon:   <CheckCircle className="w-10 h-10 text-green-400" />,
      title:  'Already Activated',
      body:   'This account has already been activated. You can log in to the mobile app directly.',
      accent: 'text-green-400',
    },
    expired: {
      icon:   <XCircle className="w-10 h-10 text-yellow-400" />,
      title:  'Link Expired',
      body:   'This activation link has expired (links are valid for 72 hours). Please contact your administrator to resend the activation email.',
      accent: 'text-yellow-400',
    },
    error: {
      icon:   <XCircle className="w-10 h-10 text-red-400" />,
      title:  'Activation Failed',
      body:   message || 'Something went wrong. Please contact your administrator.',
      accent: 'text-red-400',
    },
  }

  const c = config[state]

  return (
    <div className="w-full max-w-md bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-900 px-8 py-6 text-center">
        <Shield className="w-8 h-8 text-white mx-auto mb-2" />
        <h1 className="text-white text-lg font-bold">ResponSight</h1>
        <p className="text-blue-200 text-xs mt-1">Account Activation</p>
      </div>

      {/* Body */}
      <div className="px-8 py-10 text-center">
        <div className="flex justify-center mb-5">{c.icon}</div>
        <h2 className={`text-xl font-bold mb-3 ${c.accent}`}>{c.title}</h2>
        <p className="text-sm text-[#a0a0a0] leading-relaxed">{c.body}</p>

        {(state === 'success' || state === 'already') && (
          <div className="mt-6 bg-[#111] border border-[#2a2a2a] rounded-xl p-4 text-left">
            <p className="text-xs text-[#888] mb-2 font-semibold uppercase tracking-wider">Next steps</p>
            <ol className="text-sm text-[#c0c0c0] space-y-1 list-decimal list-inside">
              <li>Download / open the ResponSight mobile app</li>
              <li>Log in with your email &amp; temporary password</li>
              <li>Go to Profile → Security Settings → Change Password</li>
            </ol>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-[#111] border-t border-[#2a2a2a] px-8 py-4 text-center">
        <p className="text-[#555] text-xs">
          Having trouble? Contact your agency administrator.
        </p>
      </div>
    </div>
  )
}

export default function ActivatePage() {
  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-full max-w-md bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl shadow-2xl overflow-hidden p-10 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-brand-400 mx-auto mb-4" />
          <p className="text-text-muted text-sm">Initialising…</p>
        </div>
      }>
        <ActivateContent />
      </Suspense>
    </div>
  )
}

