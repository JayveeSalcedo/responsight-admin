import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // ── Look up token ────────────────────────────────────────────────────────
    // Read token row with expiry/used flags to validate activation.
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from('activation_tokens')
      .select('user_id, expires_at, used')
      .eq('token', token)
      .maybeSingle()

    if (fetchErr || !row) {
      return NextResponse.json({ error: 'Invalid activation link.' }, { status: 404 })
    }

    if (row.used) {
      return NextResponse.json({ alreadyActive: true })
    }

    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json({ expired: true })
    }

    // ── Activate the user ────────────────────────────────────────────────────
    // Set verified flag so the account can log in.
    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ verified: true })
      .eq('id', row.user_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // ── Mark token as used ───────────────────────────────────────────────────
    await supabaseAdmin
      .from('activation_tokens')
      .update({ used: true })
      .eq('token', token)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('activate-account error:', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}
