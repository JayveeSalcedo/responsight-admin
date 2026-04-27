import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Uses service role key so it has EXECUTE permission on hash_password()
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json()
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Missing password' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.rpc('hash_password', { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'hash_password returned null — check DB function exists' }, { status: 500 })

    return NextResponse.json({ hash: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
