import { NextRequest, NextResponse } from 'next/server'

const SENTIMENT_API  = (process.env.SENTIMENT_API_URL  ?? 'http://localhost:8000').trim().replace(/\/+$/, '')
const HF_TOKEN       = process.env.HF_TOKEN ?? ''

function hfHeaders() {
  // Optional HF token for authenticated Spaces or rate-limit bypass.
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (HF_TOKEN) h['Authorization'] = `Bearer ${HF_TOKEN}`
  return h
}

// ── Single analysis ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Support both single { text, rating } and batch { items: [...] }
    const isBatch = Array.isArray(body?.items)
    const endpoint = isBatch ? '/analyze/batch' : '/analyze'

    // Pass through to the Python service (or HF Space).
    const res = await fetch(`${SENTIMENT_API}${endpoint}`, {
      method:  'POST',
      headers: hfHeaders(),
      body:    JSON.stringify(body),
      // 30s timeout — HF Spaces free tier can take ~20s on cold start after idle
      signal:  AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Service error' }))
      return NextResponse.json({ error: err.detail ?? 'Service error' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    // Service not running — return a clear error so the UI can fall back to lexicon
    if (err?.name === 'TimeoutError' || err?.cause?.code === 'ECONNREFUSED' || err?.cause?.code === 'ENOTFOUND') {
      return NextResponse.json(
        { error: 'Sentiment service unavailable', offline: true },
        { status: 503 }
      )
    }
    console.error('[analyze-sentiment] Unexpected error:', err)
    return NextResponse.json({ error: err.message ?? 'Unknown error', offline: true }, { status: 500 })
  }
}

// ── Health check passthrough ──────────────────────────────────────────────────
export async function GET() {
  try {
    const res = await fetch(`${SENTIMENT_API}/health`, {
      headers: HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {},
      signal: AbortSignal.timeout(15_000), // HF Spaces needs more time on cold start
    })
    const data = await res.json()
    return NextResponse.json({ ...data, url: SENTIMENT_API })
  } catch (err: any) {
    console.error('[analyze-sentiment] Health check failed:', err?.message)
    return NextResponse.json({ status: 'offline', url: SENTIMENT_API }, { status: 503 })
  }
}
