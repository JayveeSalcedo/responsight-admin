'use client'

import { useEffect, useState } from 'react'
import { LoadingScreen } from './LoadingScreen'

export function AppLoader() {
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Dismiss after the page has fully loaded + a short grace period
    function dismiss() {
      setTimeout(() => setDone(true), 600)
    }

    if (document.readyState === 'complete') {
      dismiss()
    } else {
      window.addEventListener('load', dismiss, { once: true })
      // Safety fallback — never block longer than 3s
      const fallback = setTimeout(() => setDone(true), 3000)
      return () => {
        window.removeEventListener('load', dismiss)
        clearTimeout(fallback)
      }
    }
  }, [])

  return <LoadingScreen done={done} />
}
