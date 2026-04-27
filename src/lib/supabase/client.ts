import { createBrowserClient } from '@supabase/ssr'

// Singleton — reuse the same client across the entire app.
// createBrowserClient is cheap but calling it on every render
// still allocates a new object and re-reads env vars every time.
let _client: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return _client
}
