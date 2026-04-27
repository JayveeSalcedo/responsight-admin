// Simple in-memory cache with TTL.
// Lives for the duration of the browser session (page refresh clears it).
// Prevents redundant fetches when navigating between pages.

interface CacheEntry<T> {
  data: T
  expiry: number
}

const store = new Map<string, CacheEntry<unknown>>()

export const pageCache = {
  get<T>(key: string): T | null {
    const entry = store.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.expiry) { store.delete(key); return null }
    return entry.data
  },

  set<T>(key: string, data: T, ttlMs = 30_000) {
    store.set(key, { data, expiry: Date.now() + ttlMs })
  },

  invalidate(prefix: string) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key)
    }
  },
}
