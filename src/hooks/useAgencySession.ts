'use client'

import { useEffect, useState } from 'react'

export interface AgencySession {
  userId:     string
  name:       string
  role:       string
  agencyId:   string | null
  agencyType: string | null
}

export function isCDRRMO(session: AgencySession | null) {
  return session?.agencyType === 'CDRRMO' || session?.agencyType == null
}

export function agencyFilter(session: AgencySession | null): string | null {
  if (isCDRRMO(session)) return null
  return session?.agencyId ?? null
}

// Read localStorage synchronously on the client so the first render
// already has the session — prevents the double-fetch that happened
// when session was null on mount then set in useEffect.
function readSession(): AgencySession | null {
  if (typeof window === 'undefined') return null
  const userId = localStorage.getItem('rs_user_id') ?? ''
  if (!userId) return null
  return {
    userId,
    name:       localStorage.getItem('rs_user_name')   ?? '',
    role:       localStorage.getItem('rs_user_role')   ?? '',
    agencyId:   localStorage.getItem('rs_agency_id')   ?? null,
    agencyType: localStorage.getItem('rs_agency_type') ?? null,
  }
}

export function useAgencySession(): AgencySession | null {
  // initialise synchronously — no useEffect, no null-then-value flip
  const [session, setSession] = useState<AgencySession | null>(readSession)

  // Still watch for storage changes (e.g. login/logout in another tab)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key?.startsWith('rs_')) setSession(readSession())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return session
}
