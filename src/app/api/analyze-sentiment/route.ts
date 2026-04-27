import { NextRequest, NextResponse } from 'next/server'

const SENTIMENT_API = process.env.SENTIMENT_API_URL ?? 'http://localhost:8000'

// ── Single analysis ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Support both single { text, rating } and batch { items: [...] }
    const isBatch = Array.isArray(body?.items)
    const endpoint = isBatch ? '/analyze/batch' : '/analyze'

    const res = await fetch(`${SENTIMENT_API}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      // 10s timeout — models can be slow on first inference after idle
      signal:  AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Service error' }))
      return NextResponse.json({ error: err.detail ?? 'Service error' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    // Service not running — return a clear error so the UI can fall back to lexicon
    if (err?.name === 'TimeoutError' || err?.cause?.code === 'ECONNREFUSED') {
      return NextResponse.json(
        { error: 'Sentiment service unavailable', offline: true },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 })
  }
}

// ── Health check passthrough ──────────────────────────────────────────────────
export async function GET() {
  try {
    const res = await fetch(`${SENTIMENT_API}/health`, {
      signal: AbortSignal.timeout(3_000),
    })
    const data = await res.json()
    return NextResponse.json({ ...data, url: SENTIMENT_API })
  } catch {
    return NextResponse.json({ status: 'offline', url: SENTIMENT_API }, { status: 503 })
  }
}
