'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar } from '@/components/layout/TopBar'
import { computeSentiment, analyseSentiment, computeSentimentBatch, detectLanguage } from '@/lib/sentiment'
import type { SentimentLabel, ModelSentimentResult, DetectedLanguage } from '@/types'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, Cell, LabelList,
} from 'recharts'
import { format, subDays, startOfDay, subWeeks, subMonths, isAfter, isBefore } from 'date-fns'
import {
  Star, MapPin, Shield, MessageSquare, Brain, Building2, FileText,
  ChevronDown, ChevronUp, Cpu, Zap, WifiOff, AlertTriangle, TrendingUp,
  TrendingDown, Minus, Download, Users, BarChart2, Lightbulb,
} from 'lucide-react'
import { timeAgo } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportRating {
  id: string; created_at: string; rating: number; feedback: string | null; is_anonymous: boolean
  citizen:   { first_name: string; last_name: string; barangay: string | null; zone: string | null } | null
  responder: { id: string; first_name: string; last_name: string } | null
  report:    { title: string; incident_type: string; location: string; severity: string } | null
}

interface AgencyFeedback {
  id: string; created_at: string; rating: number; feedback: string | null; is_anonymous: boolean
  agency: string; barangay: string | null
  citizen: { first_name: string; last_name: string; barangay: string | null; zone: string | null } | null
}

// ─── Sentiment config ─────────────────────────────────────────────────────────

const SENT_CFG: Record<SentimentLabel, { color: string; bg: string; border: string; label: string; emoji: string; group: 'valence' | 'emotion' }> = {
  positive: { color: '#22c55e', bg: 'bg-green-500/10',   border: 'border-green-500/20',   label: 'Positive', emoji: '👍', group: 'valence' },
  neutral:  { color: '#3b82f6', bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    label: 'Neutral',  emoji: '😐', group: 'valence' },
  negative: { color: '#f97316', bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  label: 'Negative', emoji: '👎', group: 'valence' },
  joy:      { color: '#facc15', bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20',  label: 'Joy',      emoji: '😊', group: 'emotion' },
  sadness:  { color: '#60a5fa', bg: 'bg-blue-400/10',    border: 'border-blue-400/20',    label: 'Sadness',  emoji: '😢', group: 'emotion' },
  anger:    { color: '#a78bfa', bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  label: 'Anger',    emoji: '😠', group: 'emotion' },
  fear:     { color: '#a855f7', bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  label: 'Fear',     emoji: '😨', group: 'emotion' },
  disgust:  { color: '#84cc16', bg: 'bg-lime-500/10',    border: 'border-lime-500/20',    label: 'Disgust',  emoji: '🤢', group: 'emotion' },
  surprise: { color: '#f472b6', bg: 'bg-pink-500/10',    border: 'border-pink-500/20',    label: 'Surprise', emoji: '😲', group: 'emotion' },
  panic:    { color: '#ef4444', bg: 'bg-red-500/10',     border: 'border-red-500/20',     label: 'Panic',    emoji: '🚨', group: 'emotion' },
}

const VALENCE_LABELS:  SentimentLabel[] = ['positive', 'neutral', 'negative']
const EMOTION_LABELS:  SentimentLabel[] = ['joy', 'sadness', 'anger', 'fear', 'disgust', 'surprise', 'panic']
const ALL_LABELS:      SentimentLabel[] = [...VALENCE_LABELS, ...EMOTION_LABELS]

const AGENCY_CFG: Record<string, { color: string; bg: string; logo: string }> = {
  CDRRMO: { color: '#4A90E2', bg: 'bg-blue-500/10',   logo: '/images/CDRRMO.png' },
  BFP:    { color: '#7c3aed', bg: 'bg-violet-500/10', logo: '/images/BFP.png'    },
  PNP:    { color: '#003DA5', bg: 'bg-indigo-500/10', logo: '/images/PNP.png'    },
}

const SEVERITY_BAR:  Record<string, string> = { urgent: 'bg-violet-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-green-500' }
const SEVERITY_PILL: Record<string, string> = {
  low:    'bg-green-500/10 text-green-400 border-green-500/20',
  medium: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  high:   'bg-violet-500/10 text-violet-400 border-violet-500/20',
  urgent: 'bg-violet-600/20 text-violet-300 border-violet-600/30',
}
const INCIDENT_ICONS: Record<string, string> = { fire: '🔥', flood: '🌊', accident: '🚗', medical: '🏥', crime: '🚨', other: '⚠️' }
const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','is','was','are','were','be','been',
  'have','has','had','do','did','will','would','could','should','may','might','that','this','it','its',
  'i','me','we','our','you','your','they','their','he','she','his','her','very','so','just','also',
  'mga','ang','ng','na','sa','ay','ko','mo','po','opo','yung','lang','din','rin','naman','pero','kasi',
])
const TOOLTIP_STYLE = { backgroundColor: '#13161e', border: '1px solid #1e2330', borderRadius: '8px', color: '#f0f2f8', fontSize: '12px' }

// ─── Severity score helper (for flagged queue sorting) ────────────────────────
// severity score: lower rating = higher urgency, anger/negative sentiment amplifies
function severityScore(rating: number, sentiment: ReturnType<typeof computeSentiment>): number {
  const ratingScore = (5 - rating) * 20          // 0-80
  const sentBoost   = sentiment.label === 'anger' ? 20 : sentiment.label === 'negative' ? 10 : 0
  return ratingScore + sentBoost
}

// ─── CSV export helper ────────────────────────────────────────────────────────
function exportToCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = String(r[h] ?? '').replace(/"/g, '""')
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v
      }).join(',')
    ),
  ].join('\n')
  const blob = new URL(`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`)
  const a = document.createElement('a')
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  a.download = filename
  a.click()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StarRow({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5'
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(s => <Star key={s} className={`${cls} ${s <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-surface-muted fill-surface-muted'}`} />)}
    </div>
  )
}

function ServiceStatusBadge({ status }: { status: 'checking' | 'online' | 'offline' }) {
  if (status === 'checking') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-muted border border-surface-border text-text-muted animate-pulse">
      <Brain className="w-3 h-3" /> Checking ML service…
    </span>
  )
  if (status === 'online') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-green-500/10 border border-green-500/20 text-green-400">
      <Cpu className="w-3 h-3" /> ML Model active
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-muted border border-surface-border text-text-muted" title="Start: cd sentiment_service && python main.py">
      <WifiOff className="w-3 h-3" /> Lexicon fallback
    </span>
  )
}

const ratingLabel = (r: number) => ['','Poor','Fair','Good','Very Good','Excellent'][r] ?? ''
const ratingColor = (r: number) => r >= 5 ? 'text-emerald-400' : r >= 4 ? 'text-green-400' : r >= 3 ? 'text-yellow-400' : r >= 2 ? 'text-orange-400' : 'text-violet-400'

const LANG_CFG: Record<DetectedLanguage, { label: string; flag: string; cls: string }> = {
  english: { label: 'EN',      flag: '🇬🇧', cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
  tagalog: { label: 'TL',      flag: '🇵🇭', cls: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500' },
  taglish: { label: 'Taglish', flag: '🇵🇭', cls: 'bg-pink-500/10 border-pink-500/20 text-pink-400' },
}

function LanguageBadge({ language }: { language: DetectedLanguage }) {
  const cfg = LANG_CFG[language]
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${cfg.cls}`} title={`Detected language: ${language}`}>
      {cfg.flag} {cfg.label}
    </span>
  )
}

function parseImprovementText(feedback: string | null): { improvement: string | null; overall: string | null } {
  if (!feedback) return { improvement: null, overall: null }
  const lines = feedback.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length <= 1) return { improvement: null, overall: feedback }
  return { improvement: lines[0], overall: lines.slice(1).join(' ') }
}

function SentimentBadge({ rating, feedback, modelResult }: { rating: number; feedback: string | null; modelResult?: ModelSentimentResult }) {
  const sent = modelResult ?? computeSentiment(rating, feedback)
  const cfg  = SENT_CFG[sent.label]
  const isModel = modelResult?.source === 'model'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.bg} ${cfg.border}`} style={{ color: cfg.color }}
      title={isModel && modelResult ? `ML model · ${modelResult.emotion} (${Math.round(modelResult.emotion_score * 100)}%)` : 'Lexicon-based'}>
      {isModel ? <Cpu className="w-2.5 h-2.5 opacity-70" /> : <Zap className="w-2.5 h-2.5 opacity-50" />}
      {cfg.label}
      <span className="opacity-60">{Math.round(sent.confidence * 100)}%</span>
    </span>
  )
}

// ─── Analysis Panel ───────────────────────────────────────────────────────────

function SentimentAnalysisPanel({ rating, feedback, modelResult }: {
  rating: number; feedback: string | null; modelResult?: ModelSentimentResult
}) {
  const result = modelResult ?? computeSentiment(rating, feedback)
  const cfg    = SENT_CFG[result.label]
  const isModel = modelResult?.source === 'model'

  return (
    <div className="mt-2 rounded-xl border border-surface-border bg-surface-muted/60 overflow-hidden text-xs">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-surface-border flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Source</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border ${isModel ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-surface-muted border-surface-border text-text-muted'}`}>
            {isModel ? <><Cpu className="w-2.5 h-2.5" /> ML Model</> : <><Zap className="w-2.5 h-2.5" /> Lexicon</>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Label</span>
          <span className={`px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.border}`} style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Confidence</span>
          <span className="font-bold text-text-primary">{Math.round(result.confidence * 100)}%</span>
          <div className="w-20 h-1.5 bg-surface-card rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.round(result.confidence * 100)}%`, backgroundColor: cfg.color }} />
          </div>
        </div>
        {isModel && modelResult && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Emotion</span>
              <span className="font-bold text-text-primary capitalize">{modelResult.emotion}</span>
              <span className="text-text-muted">({Math.round(modelResult.emotion_score * 100)}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Valence</span>
              <span className={`font-bold capitalize ${modelResult.valence === 'positive' ? 'text-green-400' : modelResult.valence === 'negative' ? 'text-violet-400' : 'text-text-muted'}`}>{modelResult.valence}</span>
              <span className="text-text-muted">({Math.round(modelResult.valence_score * 100)}%)</span>
            </div>
          </>
        )}
        {!isModel && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Valence score</span>
              <span className={`font-bold ${result.score > 0 ? 'text-green-400' : result.score < 0 ? 'text-violet-400' : 'text-text-muted'}`}>
                {result.score > 0 ? '+' : ''}{result.score.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted">Scored tokens</span>
              <span className="font-bold text-text-primary">{result.tokens}</span>
            </div>
          </>
        )}
      </div>
      {isModel && modelResult && modelResult.all_emotions.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">All Emotions</p>
          {modelResult.all_emotions.filter(e => e.label in SENT_CFG).sort((a, b) => b.score - a.score).map(e => {
            const ecfg = SENT_CFG[e.label as SentimentLabel]
            return (
              <div key={e.label} className="flex items-center gap-2">
                <span className="w-16 text-[10px] capitalize" style={{ color: ecfg.color }}>{ecfg.label}</span>
                <div className="flex-1 h-1.5 bg-surface-card rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(e.score * 100)}%`, backgroundColor: ecfg.color }} />
                </div>
                <span className="text-[10px] text-text-muted w-8 text-right">{Math.round(e.score * 100)}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── d3-cloud loader ────────────────────────────────────────────────────────────
let _d3CloudReady = false
let _d3CloudPromise: Promise<void> | null = null
function ensureD3Cloud(): Promise<void> {
  if (_d3CloudReady) return Promise.resolve()
  if (_d3CloudPromise) return _d3CloudPromise
  _d3CloudPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).d3?.layout?.cloud) { _d3CloudReady = true; resolve(); return }
    const s1 = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js', crossOrigin: 'anonymous' })
    s1.onload = () => {
      const s2 = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/d3-cloud/1.2.7/d3.layout.cloud.min.js', crossOrigin: 'anonymous' })
      s2.onload  = () => { _d3CloudReady = true; resolve() }
      s2.onerror = reject
      document.head.appendChild(s2)
    }
    s1.onerror = reject
    document.head.appendChild(s1)
  })
  return _d3CloudPromise
}

interface PlacedWord { text: string; count: number; size: number; x: number; y: number; rotate: number; color: string }
function WordCloud({ texts }: { texts: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [placed, setPlaced]     = useState<PlacedWord[]>([])
  const [dims, setDims]         = useState({ w: 0, h: 220 })
  const [libReady, setLibReady] = useState(_d3CloudReady)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([e]) => { const w = Math.floor(e.contentRect.width); if (w > 0) setDims(d => ({ ...d, w })) })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { if (_d3CloudReady) return; ensureD3Cloud().then(() => setLibReady(true)).catch(console.error) }, [])

  const wordFreqs = useMemo(() => {
    const freq: Record<string, number> = {}
    texts.forEach(t => t.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w)).forEach(w => { freq[w] = (freq[w] ?? 0) + 1 }))
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([text, count]) => ({ text, count }))
  }, [texts])

  useEffect(() => {
    if (!libReady || !wordFreqs.length || dims.w === 0) return
    const max = wordFreqs[0].count, min = wordFreqs[wordFreqs.length-1].count, range = max === min ? 1 : max - min
    let cancelled = false
    ;(window as any).d3.layout.cloud()
      .size([dims.w, dims.h])
      .words(wordFreqs.map(({ text, count }) => ({ text, count, size: Math.round(13 + ((count - min) / range) * 38) })))
      .padding(5).rotate(() => [-90,-45,0,0,0,45,90][Math.floor(Math.random()*7)])
      .font('ui-sans-serif, system-ui, sans-serif').fontSize((d: any) => d.size)
      .on('end', (words: any[]) => {
        if (cancelled) return
        setPlaced(words.map(w => ({ text: w.text, count: w.count, size: w.size, x: w.x??0, y: w.y??0, rotate: w.rotate??0, color: SENT_CFG[analyseSentiment(w.text).label].color })))
      }).start()
    return () => { cancelled = true }
  }, [libReady, wordFreqs, dims.w, dims.h])

  if (!wordFreqs.length) return <p className="text-xs text-text-muted text-center py-8">No feedback text yet</p>
  return (
    <div ref={containerRef} className="w-full" style={{ height: dims.h }}>
      {dims.w > 0 && (
        <svg width={dims.w} height={dims.h} style={{ overflow:'visible' }}>
          <g transform={`translate(${dims.w/2},${dims.h/2})`}>
            {placed.length === 0 && <text x={0} y={0} textAnchor="middle" fill="#4d566b" fontSize={12}>{libReady ? 'Laying out…' : 'Loading…'}</text>}
            {placed.map(w => (
              <text key={w.text} textAnchor="middle" transform={`translate(${w.x},${w.y}) rotate(${w.rotate})`} fill={w.color}
                style={{ fontSize: w.size, fontWeight: w.size > 34 ? 700 : w.size > 22 ? 600 : 500, cursor: 'default', userSelect: 'none', opacity: 0.85 }}
                onMouseEnter={e => (e.currentTarget.style.opacity='1')} onMouseLeave={e => (e.currentTarget.style.opacity='0.85')}>
                <title>{w.text} ({w.count}×)</title>{w.text}
              </text>
            ))}
          </g>
        </svg>
      )}
    </div>
  )
}

// ─── Top Keywords Bar Chart ───────────────────────────────────────────────────

function TopKeywordsChart({ texts, topN = 15 }: { texts: string[]; topN?: number }) {
  const data = useMemo(() => {
    const freq: Record<string, number> = {}
    texts.forEach(t =>
      t.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
        .forEach(w => { freq[w] = (freq[w] ?? 0) + 1 })
    )
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([word, count]) => ({
      word, count, sentiment: analyseSentiment(word).label, color: SENT_CFG[analyseSentiment(word).label].color,
    }))
  }, [texts, topN])

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (!data.length) return <p className="text-xs text-text-muted text-center py-8">No feedback text yet</p>

  return (
    <ResponsiveContainer width="100%" height={topN * 28 + 20}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" horizontal={false} />
        <XAxis type="number" tick={{ fill: '#4d566b', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="word" width={80} tick={{ fill: '#a0aec0', fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#ffffff08' }}
          formatter={(value: any, _: any, props: any) => [`${value} mention${value !== 1 ? 's' : ''}`, `${SENT_CFG[props.payload.sentiment as SentimentLabel].emoji} ${props.payload.word}`]} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}
          onMouseEnter={(_, i) => setActiveIndex(i)} onMouseLeave={() => setActiveIndex(null)}>
          {data.map((entry, i) => <Cell key={entry.word} fill={entry.color} opacity={activeIndex === null || activeIndex === i ? 0.85 : 0.35} />)}
          <LabelList dataKey="count" position="right" style={{ fill: '#7a8499', fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── NEW: Aggregated Improvement Themes ──────────────────────────────────────

function ImprovementThemes({ items }: { items: { feedback: string | null }[] }) {
  const themes = useMemo(() => {
    const phrases: Record<string, number> = {}
    items.forEach(r => {
      const { improvement } = parseImprovementText(r.feedback)
      if (!improvement) return
      const words = improvement.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
      // bi-grams + individual words
      words.forEach(w => { phrases[w] = (phrases[w] ?? 0) + 1 })
      for (let i = 0; i < words.length - 1; i++) {
        const bg = `${words[i]} ${words[i+1]}`
        phrases[bg] = (phrases[bg] ?? 0) + 1
      }
    })
    return Object.entries(phrases).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([phrase, count]) => ({ phrase, count }))
  }, [items])

  const total = items.filter(r => parseImprovementText(r.feedback).improvement).length

  if (!total) return (
    <div className="text-center py-8 text-xs text-text-muted">
      <Lightbulb className="w-6 h-6 mx-auto mb-2 opacity-30" />
      No improvement suggestions yet
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">{total} entries with improvement feedback</p>
      {themes.length === 0 ? (
        <p className="text-xs text-text-muted">No repeated phrases yet — check individual cards below</p>
      ) : (
        <div className="space-y-2">
          {themes.map(({ phrase, count }) => {
            const pct = Math.round((count / total) * 100)
            return (
              <div key={phrase} className="flex items-center gap-3">
                <span className="text-xs text-text-primary font-medium w-40 truncate capitalize">{phrase}</span>
                <div className="flex-1 h-2 bg-surface-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-orange-500/70 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-text-muted w-14 text-right">{count}× ({pct}%)</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── NEW: Flagged Feedback Queue ──────────────────────────────────────────────

interface FlaggedItem {
  id: string
  created_at: string
  rating: number
  feedback: string | null
  is_anonymous: boolean
  citizen: { first_name: string; last_name: string; barangay: string | null; zone: string | null } | null
  responder: { id: string; first_name: string; last_name: string } | null | undefined
  report: { title: string; incident_type: string; location: string; severity: string } | null | undefined
  agency?: string
  sentiment: ReturnType<typeof computeSentiment>
  urgencyScore: number
}

function FlaggedQueue({ items }: { items: FlaggedItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (!items.length) return (
    <div className="text-center py-10 glass rounded-xl">
      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-green-400 opacity-50" />
      <p className="text-sm text-green-400 font-medium">All clear</p>
      <p className="text-xs text-text-muted mt-1">No negative or angry feedback requiring attention</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {items.map((fb, idx) => {
        const sentCfg = SENT_CFG[fb.sentiment.label]
        const isTop = idx < 3
        return (
          <div key={fb.id} className={`glass rounded-xl overflow-hidden border ${isTop ? 'border-violet-500/30' : 'border-surface-border'}`}>
            {isTop && <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 to-orange-500" />}
            <div className="p-4">
              <div className="flex items-start gap-3">
                {/* Urgency rank */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${isTop ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30' : 'bg-surface-muted text-text-muted'}`}>
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">
                        {fb.is_anonymous ? 'Anonymous' : fb.citizen ? `${fb.citizen.first_name} ${fb.citizen.last_name}` : 'Unknown'}
                      </span>
                      {fb.agency && (() => {
                        const cfg = AGENCY_CFG[fb.agency]
                        return (
                          <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-bold" style={{ color: cfg?.color ?? '#888', borderColor: (cfg?.color ?? '#888') + '40', backgroundColor: (cfg?.color ?? '#888') + '15' }}>
                            {cfg?.logo ? <img src={cfg.logo} alt={fb.agency} className="w-3 h-3 object-contain" /> : null}
                            {fb.agency}
                          </span>
                        )
                      })()}
                      <StarRow rating={fb.rating} />
                      <span className={`text-xs font-semibold ${ratingColor(fb.rating)}`}>{ratingLabel(fb.rating)}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${sentCfg.bg} ${sentCfg.border}`} style={{ color: sentCfg.color }}>
                        {sentCfg.emoji} {sentCfg.label}
                      </span>
                    </div>
                    <span className="text-[11px] text-text-muted shrink-0">{timeAgo(fb.created_at)}</span>
                  </div>
                  {fb.feedback && (() => {
                    const { improvement, overall } = parseImprovementText(fb.feedback)
                    return (
                      <div className="mt-2 space-y-1.5">
                        {improvement && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/15">
                            <span className="text-orange-400 text-xs mt-0.5 shrink-0">⚠️</span>
                            <div>
                              <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Needs improvement</p>
                              <p className="text-xs text-text-primary leading-relaxed">{improvement}</p>
                            </div>
                          </div>
                        )}
                        {overall && (
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
                            <p className="text-sm text-text-primary leading-relaxed">{overall}</p>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {fb.report && (
                    <div className="mt-2 rounded-lg bg-surface-muted border border-surface-border p-2.5 flex items-center gap-2 flex-wrap">
                      <span>{INCIDENT_ICONS[fb.report.incident_type] ?? '⚠️'}</span>
                      <span className="text-xs font-semibold text-text-primary truncate">{fb.report.title}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border capitalize font-bold ${SEVERITY_PILL[fb.report.severity] ?? ''}`}>{fb.report.severity}</span>
                      <span className="text-xs text-text-muted flex items-center gap-1"><MapPin className="w-3 h-3" />{fb.report.location}</span>
                    </div>
                  )}
                  {fb.responder && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-brand-400 shrink-0" />
                      <span className="text-xs text-text-muted">Responder: <span className="text-text-secondary font-medium">{fb.responder.first_name} {fb.responder.last_name}</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── NEW: Per-Responder Breakdown ─────────────────────────────────────────────

function ResponderBreakdown({ items }: { items: (ReportRating & { sentiment: ReturnType<typeof computeSentiment> })[] }) {
  const stats = useMemo(() => {
    const map: Record<string, { id: string; name: string; ratings: number[]; sentiments: SentimentLabel[]; feedbacks: string[] }> = {}
    items.forEach(r => {
      if (!r.responder) return
      const key = r.responder.id
      if (!map[key]) map[key] = { id: key, name: `${r.responder.first_name} ${r.responder.last_name}`, ratings: [], sentiments: [], feedbacks: [] }
      map[key].ratings.push(r.rating)
      map[key].sentiments.push(r.sentiment.label)
      if (r.feedback) map[key].feedbacks.push(r.feedback)
    })
    return Object.values(map).map(r => {
      const avg = r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length
      const negCount = r.sentiments.filter(s => s === 'negative' || s === 'anger').length
      return { ...r, avg: Math.round(avg * 10) / 10, negCount, total: r.ratings.length }
    }).sort((a, b) => a.avg - b.avg) // worst first = most actionable
  }, [items])

  if (!stats.length) return (
    <div className="text-center py-8 text-xs text-text-muted">
      <Users className="w-6 h-6 mx-auto mb-2 opacity-30" />
      No responder data linked to ratings yet
    </div>
  )

  return (
    <div className="space-y-2">
      {stats.map((r, i) => {
        const color = ratingColor(Math.round(r.avg))
        const negPct = Math.round((r.negCount / r.total) * 100)
        return (
          <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl glass border border-surface-border">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30' : 'bg-surface-muted text-text-muted'}`}>
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-text-primary truncate">{r.name}</span>
                {i === 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 font-semibold">Needs attention</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className={`text-sm font-bold ${color}`}>{r.avg} ★</span>
                <span className="text-xs text-text-muted">{r.total} rating{r.total !== 1 ? 's' : ''}</span>
                {r.negCount > 0 && <span className="text-xs text-orange-400">{r.negCount} negative ({negPct}%)</span>}
              </div>
            </div>
            <div className="w-24 h-1.5 bg-surface-muted rounded-full overflow-hidden shrink-0">
              <div className="h-full rounded-full transition-all" style={{ width: `${(r.avg / 5) * 100}%`, backgroundColor: r.avg >= 4 ? '#22c55e' : r.avg >= 3 ? '#facc15' : '#f97316' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── NEW: Agency Trend Comparison (this period vs last period) ────────────────

function AgencyTrendComparison({ items, agency }: { items: AgencyFeedback[]; agency: string | null }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')

  const { current, previous, delta, trend } = useMemo(() => {
    const now = new Date()
    const [curStart, prevStart, prevEnd] = period === 'week'
      ? [subWeeks(now, 1), subWeeks(now, 2), subWeeks(now, 1)]
      : [subMonths(now, 1), subMonths(now, 2), subMonths(now, 1)]

    const filtered = agency ? items.filter(r => r.agency === agency) : items
    const curItems  = filtered.filter(r => isAfter(new Date(r.created_at), curStart))
    const prevItems = filtered.filter(r => isAfter(new Date(r.created_at), prevStart) && isBefore(new Date(r.created_at), prevEnd))

    const avgOf = (arr: AgencyFeedback[]) => arr.length ? Math.round((arr.reduce((s, r) => s + r.rating, 0) / arr.length) * 10) / 10 : null
    const cur = avgOf(curItems), prev = avgOf(prevItems)
    const d = cur !== null && prev !== null ? Math.round((cur - prev) * 10) / 10 : null

    return { current: { avg: cur, count: curItems.length }, previous: { avg: prev, count: prevItems.length }, delta: d, trend: d === null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat' }
  }, [items, agency, period])

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const trendColor = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-violet-400' : 'text-text-muted'
  const trendBg = trend === 'up' ? 'bg-green-500/10 border-green-500/20' : trend === 'down' ? 'bg-violet-500/10 border-violet-500/20' : 'bg-surface-muted border-surface-border'

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-text-muted" />
            Period Comparison {agency ? `— ${agency}` : '(All Agencies)'}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Are ratings improving or declining?</p>
        </div>
        <div className="flex gap-1">
          {(['week','month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 rounded-md text-xs capitalize ${period === p ? 'bg-brand-600 text-white' : 'bg-surface-muted text-text-muted'}`}>{p}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {/* Previous period */}
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-[11px] text-text-muted mb-1">Previous {period}</p>
          <p className={`text-2xl font-bold ${previous.avg !== null ? ratingColor(Math.round(previous.avg)) : 'text-text-muted'}`}>
            {previous.avg ?? '—'}
          </p>
          <p className="text-[11px] text-text-muted">{previous.count} responses</p>
        </div>
        {/* Delta */}
        <div className={`rounded-xl p-4 text-center border flex flex-col items-center justify-center gap-1 ${trendBg}`}>
          <TrendIcon className={`w-6 h-6 ${trendColor}`} />
          <p className={`text-xl font-bold ${trendColor}`}>
            {delta !== null ? `${delta > 0 ? '+' : ''}${delta}` : '—'}
          </p>
          <p className={`text-[11px] font-semibold capitalize ${trendColor}`}>{trend === 'flat' ? 'No change' : trend === 'up' ? 'Improving' : 'Declining'}</p>
        </div>
        {/* Current period */}
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-[11px] text-text-muted mb-1">This {period}</p>
          <p className={`text-2xl font-bold ${current.avg !== null ? ratingColor(Math.round(current.avg)) : 'text-text-muted'}`}>
            {current.avg ?? '—'}
          </p>
          <p className="text-[11px] text-text-muted">{current.count} responses</p>
        </div>
      </div>
    </div>
  )
}

// ─── Summary header ───────────────────────────────────────────────────────────

function SummaryHeader({ items, modelResults }: {
  items: { rating: number; feedback: string | null }[]
  modelResults?: Map<string, ModelSentimentResult>
}) {
  const total = items.length
  const avg   = total ? Math.round((items.reduce((s, r) => s + r.rating, 0) / total) * 10) / 10 : null

  const { counts, dominant, avgConf, modelCount } = useMemo(() => {
    const c = Object.fromEntries(ALL_LABELS.map(l => [l, 0])) as Record<SentimentLabel, number>
    let totalConf = 0, mlCount = 0
    items.forEach((r, i) => {
      const mr  = modelResults ? [...modelResults.values()][i] : null
      const res = mr ?? computeSentiment(r.rating, r.feedback)
      c[res.label]++
      totalConf += res.confidence
      if (mr?.source === 'model') mlCount++
    })
    const dom = (Object.entries(c) as [SentimentLabel, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral'
    return { counts: c, dominant: dom, avgConf: total ? Math.round((totalConf / total) * 100) : 0, modelCount: mlCount }
  }, [items, modelResults])

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="glass rounded-xl p-4">
        <p className="text-xs text-text-muted mb-1">Avg. Rating</p>
        <p className={`text-3xl font-bold leading-none ${ratingColor(Math.round(avg ?? 0))}`}>{avg ?? '—'}</p>
        <StarRow rating={Math.round(avg ?? 0)} />
        <p className="text-xs text-text-muted mt-1">{ratingLabel(Math.round(avg ?? 0))}</p>
      </div>
      <div className="glass rounded-xl p-4">
        <p className="text-xs text-text-muted mb-1">Total Responses</p>
        <p className="text-3xl font-bold text-text-primary leading-none">{total}</p>
        <p className="text-xs text-text-muted mt-auto pt-2">{items.filter(r => r.feedback).length} with text</p>
      </div>
      <div className={`glass rounded-xl p-4 border ${SENT_CFG[dominant]?.border ?? 'border-surface-border'}`}>
        <p className="text-xs text-text-muted mb-1">Dominant Sentiment</p>
        <p className="text-xl font-bold capitalize mt-1" style={{ color: SENT_CFG[dominant]?.color }}>{SENT_CFG[dominant]?.label}</p>
        <p className="text-xs text-text-muted">{counts[dominant]} of {total}</p>
      </div>
      <div className="glass rounded-xl p-4">
        <p className="text-xs text-text-muted flex items-center gap-1 mb-1">
          <Brain className="w-3 h-3" /> Avg. Confidence
          {modelCount > 0 && <span className="ml-auto text-[10px] text-green-400 flex items-center gap-0.5"><Cpu className="w-2.5 h-2.5" />{modelCount} ML</span>}
        </p>
        <p className="text-3xl font-bold text-text-primary leading-none">{avgConf}%</p>
        <div className="w-full h-1.5 bg-surface-muted rounded-full overflow-hidden mt-2">
          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${avgConf}%` }} />
        </div>
      </div>
    </div>
  )
}

// ─── Card Lists ───────────────────────────────────────────────────────────────

function ReportCardList({ items, modelResults }: {
  items: (ReportRating & { sentiment: ReturnType<typeof computeSentiment> })[]
  modelResults?: Map<string, ModelSentimentResult>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id)
  return (
    <div className="space-y-3">
      {items.map(fb => {
        const modelResult = modelResults?.get(fb.id)
        return (
          <div key={fb.id} className="glass rounded-xl overflow-hidden">
            <div className={`h-1 w-full ${fb.report ? SEVERITY_BAR[fb.report.severity] ?? 'bg-surface-muted' : 'bg-surface-muted'}`} />
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-brand-600/15 border border-brand-600/20 flex items-center justify-center text-brand-400 font-bold text-xs shrink-0">
                  {fb.is_anonymous || !fb.citizen ? '?' : `${fb.citizen.first_name[0]}${fb.citizen.last_name[0]}`}
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{fb.is_anonymous ? 'Anonymous' : fb.citizen ? `${fb.citizen.first_name} ${fb.citizen.last_name}` : 'Unknown'}</span>
                        {fb.is_anonymous && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-muted border border-surface-border text-text-muted">Anonymous</span>}
                        {!fb.is_anonymous && fb.citizen?.barangay && <span className="text-[11px] text-text-muted">Brgy. {fb.citizen.barangay}{fb.citizen.zone ? `, ${fb.citizen.zone}` : ''}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <StarRow rating={fb.rating} />
                        <span className={`text-xs font-semibold ${ratingColor(fb.rating)}`}>{ratingLabel(fb.rating)}</span>
                        <SentimentBadge rating={fb.rating} feedback={fb.feedback} modelResult={modelResult} />
                        {modelResult?.language && <LanguageBadge language={modelResult.language} />}
                        {fb.feedback && (
                          <button onClick={() => toggle(fb.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-surface-border text-text-muted hover:text-text-secondary hover:border-brand-500/40 transition-all">
                            <Brain className="w-2.5 h-2.5" /> Analysis {expanded === fb.id ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-text-muted shrink-0">{timeAgo(fb.created_at)}</span>
                  </div>
                  {fb.feedback && (() => {
                    const { improvement, overall } = parseImprovementText(fb.feedback)
                    return (
                      <>
                        {improvement && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/15">
                            <span className="text-orange-400 text-xs mt-0.5 shrink-0">⚠️</span>
                            <div>
                              <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Needs improvement</p>
                              <p className="text-xs text-text-primary leading-relaxed">{improvement}</p>
                            </div>
                          </div>
                        )}
                        {overall && (
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
                            <p className="text-sm text-text-primary leading-relaxed">{overall}</p>
                          </div>
                        )}
                      </>
                    )
                  })()}
                  {expanded === fb.id && <SentimentAnalysisPanel rating={fb.rating} feedback={fb.feedback} modelResult={modelResult} />}
                  {fb.report && (
                    <div className="rounded-lg bg-surface-muted border border-surface-border p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{INCIDENT_ICONS[fb.report.incident_type] ?? '⚠️'}</span>
                        <span className="text-xs font-semibold text-text-primary truncate">{fb.report.title}</span>
                        {fb.report.severity && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border capitalize ${SEVERITY_PILL[fb.report.severity] ?? ''}`}>{fb.report.severity}</span>}
                      </div>
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3 h-3 text-text-muted mt-0.5 shrink-0" />
                        <span className="text-xs text-text-secondary">{fb.report.location}</span>
                      </div>
                    </div>
                  )}
                  {fb.responder && (
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-brand-400 shrink-0" />
                      <span className="text-xs text-text-muted">Responded by <span className="text-text-secondary font-medium">{fb.responder.first_name} {fb.responder.last_name}</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AgencyCardList({ items, modelResults }: {
  items: (AgencyFeedback & { sentiment: ReturnType<typeof computeSentiment> })[]
  modelResults?: Map<string, ModelSentimentResult>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id)
  return (
    <div className="space-y-3">
      {items.map(fb => {
        const cfg = AGENCY_CFG[fb.agency] ?? { color: '#888', bg: 'bg-surface-muted', logo: '' }
        const modelResult = modelResults?.get(fb.id)
        return (
          <div key={fb.id} className="glass rounded-xl overflow-hidden">
            <div className="h-1 w-full" style={{ backgroundColor: cfg.color }} />
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full border flex items-center justify-center text-xs shrink-0" style={{ backgroundColor: `${cfg.color}20`, borderColor: `${cfg.color}40`, color: cfg.color }}>
                  {fb.is_anonymous || !fb.citizen ? '?' : `${fb.citizen.first_name[0]}${fb.citizen.last_name[0]}`}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-text-primary">{fb.is_anonymous ? 'Anonymous' : fb.citizen ? `${fb.citizen.first_name} ${fb.citizen.last_name}` : 'Unknown'}</span>
                        {fb.is_anonymous && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-muted border border-surface-border text-text-muted">Anonymous</span>}
                        {!fb.is_anonymous && (fb.citizen?.barangay || fb.barangay) && <span className="text-[11px] text-text-muted">Brgy. {fb.citizen?.barangay ?? fb.barangay}</span>}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border" style={{ backgroundColor: `${cfg.color}15`, borderColor: `${cfg.color}30`, color: cfg.color }}>
                          {cfg.logo ? <img src={cfg.logo} alt={fb.agency} className="w-3.5 h-3.5 object-contain" /> : <Building2 className="w-2.5 h-2.5" />}
                          {fb.agency}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <StarRow rating={fb.rating} />
                        <span className={`text-xs font-semibold ${ratingColor(fb.rating)}`}>{ratingLabel(fb.rating)}</span>
                        <SentimentBadge rating={fb.rating} feedback={fb.feedback} modelResult={modelResult} />
                        {modelResult?.language && <LanguageBadge language={modelResult.language} />}
                        {fb.feedback && (
                          <button onClick={() => toggle(fb.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-surface-border text-text-muted hover:text-text-secondary hover:border-brand-500/40 transition-all">
                            <Brain className="w-2.5 h-2.5" /> Analysis {expanded === fb.id ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-text-muted shrink-0">{timeAgo(fb.created_at)}</span>
                  </div>
                  {fb.feedback && (() => {
                    const { improvement, overall } = parseImprovementText(fb.feedback)
                    return (
                      <>
                        {improvement && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/15">
                            <span className="text-orange-400 text-xs mt-0.5 shrink-0">⚠️</span>
                            <div>
                              <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Needs improvement</p>
                              <p className="text-xs text-text-primary leading-relaxed">{improvement}</p>
                            </div>
                          </div>
                        )}
                        {overall && (
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-3.5 h-3.5 text-text-muted mt-0.5 shrink-0" />
                            <p className="text-sm text-text-primary leading-relaxed">{overall}</p>
                          </div>
                        )}
                      </>
                    )
                  })()}
                  {expanded === fb.id && <SentimentAnalysisPanel rating={fb.rating} feedback={fb.feedback} modelResult={modelResult} />}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Report Ratings Tab ───────────────────────────────────────────────────────

function ReportRatingsTab() {
  const supabase = createClient()
  const [ratings, setRatings]             = useState<ReportRating[]>([])
  const [loading, setLoading]             = useState(true)
  const [starFilter, setStarFilter]       = useState<number | null>(null)
  const [sentFilter, setSentFilter]       = useState<SentimentLabel | null>(null)
  const [trendDays, setTrendDays]         = useState<7 | 14 | 30>(14)
  const [modelResults, setModelResults]   = useState<Map<string, ModelSentimentResult>>(new Map())
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [activeSection, setActiveSection] = useState<'flagged' | 'responders' | 'improvements' | 'all'>('flagged')

  useEffect(() => { fetchRatings() }, [])

  async function fetchRatings() {
    setLoading(true)
    try {
      const { data: raw, error } = await supabase
        .from('response_ratings')
        .select('id, created_at, rating, feedback, is_anonymous, citizen_id, responder_id, report_id')
        .order('created_at', { ascending: false }).limit(200)
      if (error || !raw?.length) { setLoading(false); return }

      const cIds = [...new Set(raw.map(r => r.citizen_id).filter(Boolean))]
      const rIds = [...new Set(raw.map(r => r.responder_id).filter(Boolean))]
      const pIds = [...new Set(raw.map(r => r.report_id).filter(Boolean))]

      const [cR, rR, pR] = await Promise.all([
        cIds.length ? supabase.from('users').select('id,first_name,last_name,barangay,zone').in('id', cIds) : Promise.resolve({ data: [] }),
        rIds.length ? supabase.from('users').select('id,first_name,last_name').in('id', rIds) : Promise.resolve({ data: [] }),
        pIds.length ? supabase.from('incident_reports').select('id,title,incident_type,location,severity').in('id', pIds) : Promise.resolve({ data: [] }),
      ])
      const cM = Object.fromEntries((cR.data ?? []).map((u: any) => [u.id, u]))
      const rM = Object.fromEntries((rR.data ?? []).map((u: any) => [u.id, u]))
      const pM = Object.fromEntries((pR.data ?? []).map((u: any) => [u.id, u]))
      const loaded = raw.map(r => ({
        id: r.id, created_at: r.created_at, rating: r.rating, feedback: r.feedback,
        is_anonymous: r.is_anonymous ?? false,
        citizen: cM[r.citizen_id] ?? null,
        responder: rM[r.responder_id] ? { id: r.responder_id, ...rM[r.responder_id] } : null,
        report: pM[r.report_id] ?? null,
      })) as any
      setRatings(loaded)
      setLoading(false)

      const results = await computeSentimentBatch(loaded.map((r: any) => ({ rating: r.rating, feedback: r.feedback })))
      const map = new Map<string, ModelSentimentResult>()
      loaded.forEach((r: any, i: number) => map.set(r.id, results[i]))
      setModelResults(map)
      setServiceStatus(results.some(r => r.source === 'model') ? 'online' : 'offline')
    } catch(e) { console.error(e); setLoading(false); setServiceStatus('offline') }
  }

  const enriched = useMemo(() => ratings.map(r => ({
    ...r,
    sentiment: modelResults.get(r.id) ?? computeSentiment(r.rating, r.feedback),
  })), [ratings, modelResults])

  // Flagged queue: rating ≤ 2 OR sentiment is negative/anger, sorted by urgency
  const flagged = useMemo(() => enriched
    .filter(r => r.rating <= 2 || r.sentiment.label === 'negative' || r.sentiment.label === 'anger')
    .map(r => ({ ...r, urgencyScore: severityScore(r.rating, r.sentiment) }))
    .sort((a, b) => b.urgencyScore - a.urgencyScore || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  , [enriched])

  const total = enriched.length
  const trendData = useMemo(() => {
    const days = Array.from({ length: trendDays }, (_, i) => {
      const d = subDays(new Date(), trendDays - 1 - i)
      const entry: any = { date: format(d, 'MMM d'), day: format(startOfDay(d), 'yyyy-MM-dd') }
      ALL_LABELS.forEach(l => { entry[l] = 0 })
      return entry
    })
    enriched.forEach(r => {
      const b = days.find(d => d.day === format(new Date(r.created_at), 'yyyy-MM-dd'))
      if (b) b[r.sentiment.label]++
    })
    return days
  }, [enriched, trendDays])

  const starDist = [5,4,3,2,1].map(s => ({ star: s, count: ratings.filter(r => r.rating === s).length, pct: total ? Math.round(ratings.filter(r => r.rating === s).length / total * 100) : 0 }))
  const feedbackTexts = ratings.map(r => r.feedback ?? '').filter(Boolean)
  const filtered = enriched.filter(r => (!starFilter || r.rating === starFilter) && (!sentFilter || r.sentiment.label === sentFilter))

  // CSV export
  const handleExportCSV = () => {
    exportToCSV(`report-ratings-${format(new Date(), 'yyyy-MM-dd')}.csv`, enriched.map(r => ({
      id: r.id,
      date: format(new Date(r.created_at), 'yyyy-MM-dd HH:mm'),
      rating: r.rating,
      rating_label: ratingLabel(r.rating),
      sentiment: r.sentiment.label,
      confidence: Math.round(r.sentiment.confidence * 100) + '%',
      citizen: r.is_anonymous ? 'Anonymous' : r.citizen ? `${r.citizen.first_name} ${r.citizen.last_name}` : '',
      barangay: r.citizen?.barangay ?? '',
      responder: r.responder ? `${r.responder.first_name} ${r.responder.last_name}` : '',
      report_title: r.report?.title ?? '',
      report_severity: r.report?.severity ?? '',
      report_location: r.report?.location ?? '',
      improvement: parseImprovementText(r.feedback).improvement ?? '',
      overall_feedback: parseImprovementText(r.feedback).overall ?? '',
    })))
  }

  if (loading) return <div className="text-center py-16 text-sm text-text-muted animate-pulse">Loading report ratings…</div>
  if (!total)  return <div className="text-center py-16 text-sm text-text-muted">No report ratings yet</div>

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ServiceStatusBadge status={serviceStatus} />
        <div className="flex items-center gap-2">
          {serviceStatus === 'offline' && (
            <p className="text-xs text-text-muted hidden md:block">Run <code className="bg-surface-muted px-1.5 py-0.5 rounded text-brand-400">cd sentiment_service &amp;&amp; python main.py</code></p>
          )}
          <button onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-text-muted hover:text-text-primary hover:border-brand-500/40 transition-all">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <SummaryHeader items={enriched} modelResults={modelResults} />

      {/* ── Section switcher ── */}
      <div className="flex gap-1 p-1 bg-surface-muted rounded-xl w-fit border border-surface-border flex-wrap">
        {([
          { key: 'flagged',      label: 'Needs Attention', icon: AlertTriangle, badge: flagged.length > 0 ? flagged.length : undefined },
          { key: 'responders',   label: 'By Responder',    icon: Users, badge: undefined },
          { key: 'improvements', label: 'Improvement Themes', icon: Lightbulb, badge: undefined },
          { key: 'all',          label: 'All Ratings',     icon: MessageSquare, badge: undefined },
        ] as const).map(({ key, label, icon: Icon, badge }) => (
          <button key={key} onClick={() => setActiveSection(key)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === key ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
            {badge !== undefined && (
              <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-white text-[10px] font-bold">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Needs Attention ── */}
      {activeSection === 'flagged' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-violet-400" />
                Flagged Feedback
                <span className="text-xs font-normal text-text-muted">({flagged.length} items)</span>
              </p>
              <p className="text-xs text-text-muted mt-0.5">Rating ≤ 2 or negative/angry sentiment — sorted by urgency</p>
            </div>
          </div>
          <FlaggedQueue items={flagged} />
        </div>
      )}

      {/* ── By Responder ── */}
      {activeSection === 'responders' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Users className="w-4 h-4 text-text-muted" /> Responder Performance
            </p>
            <p className="text-xs text-text-muted mt-0.5">Sorted by lowest avg. rating — most actionable first</p>
          </div>
          <div className="glass rounded-xl p-5">
            <ResponderBreakdown items={enriched} />
          </div>
        </div>
      )}

      {/* ── Improvement Themes ── */}
      {activeSection === 'improvements' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-text-muted" /> Aggregated Improvement Suggestions
            </p>
            <p className="text-xs text-text-muted mt-0.5">Patterns across all "What could be improved?" responses</p>
          </div>
          <div className="glass rounded-xl p-5">
            <ImprovementThemes items={enriched} />
          </div>
          {/* Trend + Word Cloud still available here for context */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="glass rounded-xl p-5 xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Sentiment Trend</p>
                  <p className="text-xs text-text-muted">Daily breakdown</p>
                </div>
                <div className="flex gap-1">
                  {([7,14,30] as const).map(d => <button key={d} onClick={() => setTrendDays(d)} className={`px-2.5 py-1 rounded-md text-xs ${trendDays === d ? 'bg-brand-600 text-white' : 'bg-surface-muted text-text-muted'}`}>{d}d</button>)}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>{ALL_LABELS.map(k => <linearGradient key={k} id={`rg-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={SENT_CFG[k].color} stopOpacity={0.25}/><stop offset="95%" stopColor={SENT_CFG[k].color} stopOpacity={0}/></linearGradient>)}</defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                  <XAxis dataKey="date" tick={{ fill: '#4d566b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#4d566b', paddingTop: 8 }} />
                  {ALL_LABELS.map(k => <Area key={k} type="monotone" dataKey={k} name={SENT_CFG[k].label} stroke={SENT_CFG[k].color} fill={`url(#rg-${k})`} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />)}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="glass rounded-xl p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">Word Cloud</p>
              <p className="text-xs text-text-muted mb-3">Coloured by sentiment</p>
              <WordCloud texts={feedbackTexts} />
            </div>
          </div>
        </div>
      )}

      {/* ── All Ratings ── */}
      {activeSection === 'all' && (
        <div className="space-y-5">
          {/* Star distribution */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-text-primary">Star Distribution</p>
              {starFilter && <button onClick={() => setStarFilter(null)} className="text-xs text-brand-400 hover:underline">Clear</button>}
            </div>
            <div className="grid grid-cols-5 gap-3">
              {starDist.map(d => (
                <button key={d.star} onClick={() => setStarFilter(starFilter === d.star ? null : d.star)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${starFilter === d.star ? 'bg-yellow-500/10 border-yellow-500/30' : starFilter && starFilter !== d.star ? 'opacity-35 border-surface-border' : 'border-surface-border hover:border-yellow-500/20'}`}>
                  <div className="flex gap-0.5">{Array.from({length:d.star}).map((_,i) => <Star key={i} className="w-3 h-3 text-yellow-400 fill-yellow-400" />)}</div>
                  <p className="text-lg font-bold text-text-primary">{d.count}</p>
                  <p className="text-[11px] text-text-muted">{d.pct}%</p>
                  <div className="w-full h-1 bg-surface-muted rounded-full overflow-hidden"><div className="h-full bg-yellow-400 rounded-full" style={{ width: `${d.pct}%` }} /></div>
                </button>
              ))}
            </div>
          </div>

          {/* Trend + Word Cloud */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="glass rounded-xl p-5 xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Sentiment Trend</p>
                  <p className="text-xs text-text-muted">Daily breakdown</p>
                </div>
                <div className="flex gap-1">
                  {([7,14,30] as const).map(d => <button key={d} onClick={() => setTrendDays(d)} className={`px-2.5 py-1 rounded-md text-xs ${trendDays === d ? 'bg-brand-600 text-white' : 'bg-surface-muted text-text-muted'}`}>{d}d</button>)}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>{ALL_LABELS.map(k => <linearGradient key={k} id={`rg-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={SENT_CFG[k].color} stopOpacity={0.25}/><stop offset="95%" stopColor={SENT_CFG[k].color} stopOpacity={0}/></linearGradient>)}</defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                  <XAxis dataKey="date" tick={{ fill: '#4d566b', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#4d566b', paddingTop: 8 }} />
                  {ALL_LABELS.map(k => <Area key={k} type="monotone" dataKey={k} name={SENT_CFG[k].label} stroke={SENT_CFG[k].color} fill={`url(#rg-${k})`} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />)}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="glass rounded-xl p-5 flex flex-col">
              <p className="text-sm font-semibold text-text-primary mb-1">Word Cloud</p>
              <p className="text-xs text-text-muted mb-3">Coloured by detected sentiment</p>
              <div className="flex-1 flex items-center"><WordCloud texts={feedbackTexts} /></div>
              <p className="text-[10px] text-text-muted text-center mt-2">{feedbackTexts.length} text responses</p>
            </div>
          </div>

          {/* Top Keywords */}
          <div className="glass rounded-xl p-5">
            <p className="text-sm font-semibold text-text-primary mb-1">Top Keywords</p>
            <p className="text-xs text-text-muted mb-4">Most mentioned words — coloured by detected sentiment</p>
            <TopKeywordsChart texts={feedbackTexts} />
          </div>

          {/* Cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-text-muted" /> Individual Ratings
                <span className="text-xs font-normal text-text-muted">({filtered.length}{filtered.length !== total ? ` of ${total}` : ''})</span>
              </p>
              {(starFilter || sentFilter) && <button onClick={() => { setStarFilter(null); setSentFilter(null) }} className="text-xs text-brand-400 hover:underline">Clear filters</button>}
            </div>
            <ReportCardList items={filtered} modelResults={modelResults} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Agency Feedback Tab ──────────────────────────────────────────────────────

function AgencyFeedbackTab() {
  const supabase = createClient()
  const [items, setItems]               = useState<AgencyFeedback[]>([])
  const [loading, setLoading]           = useState(true)
  const [agencyFilter, setAgency]       = useState<string | null>(null)
  const [starFilter, setStarFilter]     = useState<number | null>(null)
  const [sentFilter, setSentFilter]     = useState<SentimentLabel | null>(null)
  const [modelResults, setModelResults] = useState<Map<string, ModelSentimentResult>>(new Map())
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [activeSection, setActiveSection] = useState<'flagged' | 'improvements' | 'trend' | 'all'>('flagged')

  useEffect(() => { fetchAgency() }, [])

  async function fetchAgency() {
    setLoading(true)
    try {
      const { data: raw, error } = await supabase
        .from('agency_feedback')
        .select('id, created_at, rating, feedback, is_anonymous, agency, barangay, citizen_id')
        .order('created_at', { ascending: false }).limit(200)
      if (error || !raw?.length) { setLoading(false); setServiceStatus('offline'); return }
      const cIds = [...new Set(raw.map(r => r.citizen_id).filter(Boolean))]
      const { data: users } = cIds.length ? await supabase.from('users').select('id,first_name,last_name,barangay,zone').in('id', cIds) : { data: [] }
      const cM = Object.fromEntries((users ?? []).map((u: any) => [u.id, u]))
      const loaded = raw.map(r => ({ ...r, is_anonymous: r.is_anonymous ?? false, citizen: cM[r.citizen_id] ?? null })) as any
      setItems(loaded)
      setLoading(false)

      const results = await computeSentimentBatch(loaded.map((r: any) => ({ rating: r.rating, feedback: r.feedback })))
      const map = new Map<string, ModelSentimentResult>()
      loaded.forEach((r: any, i: number) => map.set(r.id, results[i]))
      setModelResults(map)
      setServiceStatus(results.some(r => r.source === 'model') ? 'online' : 'offline')
    } catch(e) { console.error(e); setLoading(false); setServiceStatus('offline') }
  }

  const agencies = ['CDRRMO', 'BFP', 'PNP']
  const enriched = useMemo(() => items.map(r => ({
    ...r,
    sentiment: modelResults.get(r.id) ?? computeSentiment(r.rating, r.feedback),
  })), [items, modelResults])

  const agencyStats = useMemo(() => agencies.map(a => {
    const sub = enriched.filter(r => r.agency === a)
    const avg = sub.length ? Math.round((sub.reduce((s, r) => s + r.rating, 0) / sub.length) * 10) / 10 : null
    const dominant = sub.length
      ? (Object.entries(sub.reduce((c, r) => { c[r.sentiment.label] = (c[r.sentiment.label] ?? 0) + 1; return c }, {} as Record<string, number>)) as [SentimentLabel, number][]).sort((a, b) => b[1] - a[1])[0]?.[0]
      : null
    return { agency: a, count: sub.length, avg, dominant }
  }), [enriched])

  // Flagged queue
  const flagged = useMemo(() => {
    const src = agencyFilter ? enriched.filter(r => r.agency === agencyFilter) : enriched
    return src
      .filter(r => r.rating <= 2 || r.sentiment.label === 'negative' || r.sentiment.label === 'anger')
      .map(r => ({ ...r, urgencyScore: severityScore(r.rating, r.sentiment), responder: undefined, report: undefined }))
      .sort((a, b) => b.urgencyScore - a.urgencyScore || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [enriched, agencyFilter])

  const filtered = enriched.filter(r =>
    (!agencyFilter || r.agency === agencyFilter) &&
    (!starFilter   || r.rating === starFilter) &&
    (!sentFilter   || r.sentiment.label === sentFilter)
  )

  const displayItems = agencyFilter ? items.filter(r => r.agency === agencyFilter) : items
  const feedbackTexts = displayItems.map(r => r.feedback ?? '').filter(Boolean)
  const displayEnriched = agencyFilter ? enriched.filter(r => r.agency === agencyFilter) : enriched

  // CSV export
  const handleExportCSV = () => {
    exportToCSV(`agency-feedback-${agencyFilter ?? 'all'}-${format(new Date(), 'yyyy-MM-dd')}.csv`, filtered.map(r => ({
      id: r.id,
      date: format(new Date(r.created_at), 'yyyy-MM-dd HH:mm'),
      agency: r.agency,
      rating: r.rating,
      rating_label: ratingLabel(r.rating),
      sentiment: r.sentiment.label,
      confidence: Math.round(r.sentiment.confidence * 100) + '%',
      citizen: r.is_anonymous ? 'Anonymous' : r.citizen ? `${r.citizen.first_name} ${r.citizen.last_name}` : '',
      barangay: r.citizen?.barangay ?? r.barangay ?? '',
      improvement: parseImprovementText(r.feedback).improvement ?? '',
      overall_feedback: parseImprovementText(r.feedback).overall ?? '',
    })))
  }

  if (loading) return <div className="text-center py-16 text-sm text-text-muted animate-pulse">Loading agency feedback…</div>
  if (!items.length) return (
    <div className="text-center py-16 text-sm text-text-muted glass rounded-xl">
      <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
      No agency feedback yet.
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <ServiceStatusBadge status={serviceStatus} />
        <button onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-border text-text-muted hover:text-text-primary hover:border-brand-500/40 transition-all">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Agency cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {agencyStats.map(({ agency, count, avg, dominant }) => {
          const cfg    = AGENCY_CFG[agency] ?? { color: '#888', bg: 'bg-surface-muted', logo: '' }
          const active = agencyFilter === agency
          return (
            <button key={agency} onClick={() => setAgency(active ? null : agency)}
              className={`glass rounded-xl p-5 text-left transition-all border ${active ? 'border-brand-500/40' : 'border-surface-border'}`}
              style={active ? { boxShadow: `0 0 0 1px ${cfg.color}40` } : {}}>
              <div className="flex items-center justify-between mb-3">
                <div className={`w-11 h-11 rounded-xl ${cfg.bg} flex items-center justify-center overflow-hidden p-1.5`}>
                  {cfg.logo ? (
                    <img src={cfg.logo} alt={agency} className="w-full h-full object-contain drop-shadow-sm" />
                  ) : (
                    <Building2 className="w-5 h-5" style={{ color: cfg.color }} />
                  )}
                </div>
                {dominant && <span className="text-xs font-semibold px-2 py-0.5 rounded-full border" style={{ color: SENT_CFG[dominant as SentimentLabel]?.color, borderColor: SENT_CFG[dominant as SentimentLabel]?.color + '40', backgroundColor: SENT_CFG[dominant as SentimentLabel]?.color + '15' }}>{SENT_CFG[dominant as SentimentLabel]?.label}</span>}
              </div>
              <p className="text-sm font-bold text-text-primary">{agency}</p>
              <p className="text-xs text-text-muted mb-2">{count} feedback{count !== 1 ? 's' : ''}</p>
              {avg !== null
                ? <div className="flex items-center gap-2"><p className={`text-xl font-bold ${ratingColor(Math.round(avg))}`}>{avg}</p><StarRow rating={Math.round(avg)} /></div>
                : <p className="text-xs text-text-muted">No ratings yet</p>}
            </button>
          )
        })}
      </div>

      <SummaryHeader items={displayItems} modelResults={modelResults} />

      {/* Section switcher */}
      <div className="flex gap-1 p-1 bg-surface-muted rounded-xl w-fit border border-surface-border flex-wrap">
        {([
          { key: 'flagged',      label: 'Needs Attention',  icon: AlertTriangle, badge: flagged.length > 0 ? flagged.length : undefined },
          { key: 'improvements', label: 'Improvements',     icon: Lightbulb, badge: undefined },
          { key: 'trend',        label: 'Trend Comparison', icon: TrendingUp, badge: undefined },
          { key: 'all',          label: 'All Feedback',     icon: MessageSquare, badge: undefined },
        ] as const).map(({ key, label, icon: Icon, badge }) => (
          <button key={key} onClick={() => setActiveSection(key)}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === key ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
            {badge !== undefined && (
              <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-500 text-white text-[10px] font-bold">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Needs Attention ── */}
      {activeSection === 'flagged' && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-violet-400" />
              Flagged Feedback
              <span className="text-xs font-normal text-text-muted">({flagged.length} items{agencyFilter ? ` · ${agencyFilter}` : ''})</span>
            </p>
            <p className="text-xs text-text-muted mt-0.5">Rating ≤ 2 or negative/angry sentiment — sorted by urgency</p>
          </div>
          <FlaggedQueue items={flagged} />
        </div>
      )}

      {/* ── Improvements ── */}
      {activeSection === 'improvements' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-text-muted" /> Aggregated Improvement Suggestions
              {agencyFilter && <span className="text-xs font-normal text-text-muted">— {agencyFilter}</span>}
            </p>
            <p className="text-xs text-text-muted mt-0.5">Patterns across "What could be improved?" responses</p>
          </div>
          <div className="glass rounded-xl p-5">
            <ImprovementThemes items={displayEnriched} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">Word Cloud {agencyFilter ? `— ${agencyFilter}` : '(All Agencies)'}</p>
              <p className="text-xs text-text-muted mb-3">Most frequent words — coloured by sentiment</p>
              <WordCloud texts={feedbackTexts} />
            </div>
            <div className="glass rounded-xl p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">Top Keywords</p>
              <p className="text-xs text-text-muted mb-4">Most mentioned words — coloured by sentiment</p>
              <TopKeywordsChart texts={feedbackTexts} />
            </div>
          </div>
        </div>
      )}

      {/* ── Trend Comparison ── */}
      {activeSection === 'trend' && (
        <div className="space-y-4">
          <AgencyTrendComparison items={items} agency={agencyFilter} />
          <div className="glass rounded-xl p-5">
            <p className="text-sm font-semibold text-text-primary mb-1">Word Cloud</p>
            <p className="text-xs text-text-muted mb-3">Coloured by sentiment</p>
            <WordCloud texts={feedbackTexts} />
          </div>
        </div>
      )}

      {/* ── All Feedback ── */}
      {activeSection === 'all' && (
        <div className="space-y-5">
          {/* Word Cloud + Top Keywords */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="glass rounded-xl p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">Word Cloud {agencyFilter ? `— ${agencyFilter}` : '(All Agencies)'}</p>
              <p className="text-xs text-text-muted mb-3">Most frequent words — coloured by sentiment</p>
              <WordCloud texts={feedbackTexts} />
            </div>
            <div className="glass rounded-xl p-5">
              <p className="text-sm font-semibold text-text-primary mb-1">Top Keywords</p>
              <p className="text-xs text-text-muted mb-4">Most mentioned words — coloured by detected sentiment</p>
              <TopKeywordsChart texts={feedbackTexts} />
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-text-muted">Agency:</span>
            {agencies.map(a => (
              <button key={a} onClick={() => setAgency(agencyFilter === a ? null : a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${agencyFilter === a ? 'border-brand-500/40 text-brand-400 bg-brand-500/10' : 'border-surface-border text-text-muted'}`}>{a}</button>
            ))}
            <span className="text-xs text-text-muted ml-2">Stars:</span>
            {[5,4,3,2,1].map(s => (
              <button key={s} onClick={() => setStarFilter(starFilter === s ? null : s)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${starFilter === s ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10' : 'border-surface-border text-text-muted'}`}>{s}★</button>
            ))}
            {(agencyFilter || starFilter || sentFilter) && <button onClick={() => { setAgency(null); setStarFilter(null); setSentFilter(null) }} className="ml-auto text-xs text-brand-400 hover:underline">Clear all</button>}
          </div>

          {/* Cards */}
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-text-muted" /> Feedback Entries
              <span className="text-xs font-normal text-text-muted">({filtered.length}{filtered.length !== items.length ? ` of ${items.length}` : ''})</span>
            </p>
            {!filtered.length
              ? <div className="text-center py-8 text-sm text-text-muted glass rounded-xl">No entries match filters</div>
              : <AgencyCardList items={filtered} modelResults={modelResults} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeedbackPage() {
  const [tab, setTab] = useState<'reports' | 'agency'>('reports')

  return (
    <AppShell>
      <TopBar title="Feedback & Sentiment Analysis" subtitle="Citizen satisfaction · emotion detection · agency reviews" />
      <main className="flex-1 p-6 space-y-5">
        <div className="flex gap-1 p-1 bg-surface-muted rounded-xl w-fit border border-surface-border">
          <button onClick={() => setTab('reports')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'reports' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <FileText className="w-4 h-4" /> Report Ratings
          </button>
          <button onClick={() => setTab('agency')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'agency' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <Building2 className="w-4 h-4" /> Agency Feedback
          </button>
        </div>
        {tab === 'reports' ? <ReportRatingsTab /> : <AgencyFeedbackTab />}
      </main>
    </AppShell>
  )
}
