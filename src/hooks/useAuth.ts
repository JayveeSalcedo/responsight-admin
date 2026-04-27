'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

interface AdminUser {
  id:    string
  email: string
  name:  string
  role:  string
}

export function useAuth() {
  const router = useRouter()
  const [user, setUser]       = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id    = localStorage.getItem('rs_user_id')
    const email = localStorage.getItem('rs_user_email')
    const name  = localStorage.getItem('rs_user_name')
    const role  = localStorage.getItem('rs_user_role')

    if (id && email) {
      setUser({ id, email, name: name ?? email, role: role ?? 'user' })
    }
    setLoading(false)
  }, [])

  const signOut = () => {
    localStorage.removeItem('rs_user_id')
    localStorage.removeItem('rs_user_email')
    localStorage.removeItem('rs_user_name')
    localStorage.removeItem('rs_user_role')
    localStorage.removeItem('rs_agency_id')
    localStorage.removeItem('rs_agency_type')
    // Clear the middleware auth cookie
    document.cookie = 'rs_authed=; path=/; max-age=0'
    router.push('/login')
  }

  return { user, loading, signOut }
}
