'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AppShell } from '@/components/layout/AppShell'
import { TopBar } from '@/components/layout/TopBar'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts'
import { format, subDays, startOfDay, addDays, differenceInDays, endOfDay } from 'date-fns'
import {
  Sparkles, X, Loader2, MapPin, ChevronDown,
  Clock, FileDown, Check, Upload, Database, BarChart2, Map as MapIcon, BarChart as BarChartIcon,
  Trash2,
} from 'lucide-react'
import { BARANGAYS } from '@/lib/constants'
import dynamic from 'next/dynamic'
import type { MapIncident } from '@/app/map/page'

const ChoroplethMap = dynamic(() => import('@/components/map/ChoroplethMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-sm text-text-muted gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading map…
    </div>
  ),
})

const DatasetChoroplethMap = dynamic(
  () => import('@/components/map/ChoroplethMap').then(m => ({ default: m.DatasetChoroplethMap })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center text-sm text-text-muted gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading map…
      </div>
    ),
  }
)

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: '#13161e', border: '1px solid #1e2330',
  borderRadius: '8px', color: '#e2e8f0', fontSize: '12px',
}
const LEGEND_STYLE = { fontSize: '11px', color: '#8892a4' }

const STATUS_COLOR: Record<string, string> = {
  pending: '#eab308', accepted: '#3b82f6', en_route: '#06b6d4',
  arrived: '#a855f7', completed: '#22c55e', cancelled: '#6b7280', rejected: '#ef4444',
}
const TYPE_COLOR: Record<string, string> = {
  fire: '#f97316', flood: '#3b82f6', accident: '#eab308',
  medical: '#22c55e', crime: '#ef4444', other: '#6b7280',
}
const TYPE_LABEL: Record<string, string> = {
  fire: 'Fire', flood: 'Flood', accident: 'Accident',
  medical: 'Medical', crime: 'Crime', other: 'Other',
}
const INCIDENT_TYPES = ['fire', 'flood', 'accident', 'medical', 'crime', 'other'] as const
type IncidentType = typeof INCIDENT_TYPES[number]

const YEAR_COLORS: Record<string, string> = {
  '2019': '#06b6d4', '2020': '#a855f7', '2021': '#ec4899',
  '2022': '#3b82f6', '2023': '#f97316', '2024': '#22c55e', '2025': '#eab308',
}
const YEAR_PALETTE = ['#3b82f6', '#f97316', '#22c55e', '#eab308', '#a855f7', '#06b6d4', '#ec4899', '#ef4444', '#14b8a6', '#f43f5e']
function getYearColor(year: string, idx: number): string {
  return YEAR_COLORS[year] ?? YEAR_PALETTE[idx % YEAR_PALETTE.length]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── Shared tooltip ───────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatter?: (value: any) => [string, string]
}
const CustomTooltip = ({ active, payload, label, formatter }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={TOOLTIP_STYLE} className="p-2">
      {label && <p className="text-xs font-semibold mb-1">{label}</p>}
      {payload.map((entry, idx) => {
        const [valueStr, keyStr] = formatter ? formatter(entry.value) : [String(entry.value), entry.name]
        return (
          <div key={idx} className="text-xs">
            <span style={{ color: entry.color }}>{keyStr}: </span><span>{valueStr}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawReport {
  id: string; created_at: string; incident_type: string
  severity: string; status: string; location: string
  response_time_minutes: number | null
  latitude: number | null; longitude: number | null
}
type ChartKey = 'trend' | 'type' | 'status' | 'resptime' | 'hotspot'

interface YearlyBarangayData { barangay: string; months: number[]; total: number }
interface YearDataset {
  year: string; incidentType: IncidentType
  barangayData: YearlyBarangayData[]; monthlyTotals: number[]; grandTotal: number
}

// Supabase row shape (matches incident_datasets table)
interface DbDatasetRow {
  incident_type: string; year: string; location: string
  jan: number; feb: number; mar: number; apr: number; may: number; jun: number
  jul: number; aug: number; sep: number; oct: number; nov: number; dec: number
  total: number
}

// ─── Helpers (InApp tab) ──────────────────────────────────────────────────────

function extractBarangay(location: string): string | null {
  if (!location) return null
  const lower = location.toLowerCase()
  return BARANGAYS.find(b => lower.includes(b.toLowerCase())) ?? null
}

// ─── Helpers (Dataset tab) ────────────────────────────────────────────────────

function cleanLocationName(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\s*_p\s*$/, '').trim()
    .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function detectIncidentType(filename: string): IncidentType {
  const lower = filename.toLowerCase()
  if (lower.includes('fire')) return 'fire'
  if (lower.includes('flood')) return 'flood'
  if (lower.includes('accident') || lower.includes('vehicular')) return 'accident'
  if (lower.includes('medical') || lower.includes('health')) return 'medical'
  if (lower.includes('crime') || lower.includes('criminal')) return 'crime'
  return 'other'
}

function isSkippedRow(rawName: string): boolean {
  const u = rawName.trim().toUpperCase()
  if (!u || u === 'TOTAL' || u.replace(/,/g, '').trim() === '') return true
  return false
}

function parseIncidentCSV(csvText: string, incidentType: IncidentType): YearDataset[] {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const header = lines[0].split(',').map(c => c.trim().toUpperCase())
  const hasYearCol = header.includes('YEAR')

  if (hasYearCol) {
    const yearIdx = header.indexOf('YEAR')
    const yearMap = new Map<string, YearlyBarangayData[]>()
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim())
      const rawName = cols[0]
      if (isSkippedRow(rawName)) continue
      const yearRaw = cols[yearIdx]; const year = yearRaw?.trim()
      if (!year || !/^\d{4}$/.test(year)) continue
      const locationName = cleanLocationName(rawName)
      if (!locationName) continue
      const months: number[] = []
      for (let m = 1; m <= 12; m++) { const v = parseFloat(cols[m] ?? '0'); months.push(isNaN(v) ? 0 : v) }
      const total = months.reduce((a, b) => a + b, 0)
      if (total === 0) continue
      if (!yearMap.has(year)) yearMap.set(year, [])
      const existing = yearMap.get(year)!.find(b => b.barangay === locationName)
      if (existing) { existing.months = existing.months.map((v, i) => v + months[i]); existing.total += total }
      else yearMap.get(year)!.push({ barangay: locationName, months, total })
    }
    const results: YearDataset[] = []
    yearMap.forEach((barangayData, year) => {
      const monthlyTotals = Array(12).fill(0)
      barangayData.forEach(b => b.months.forEach((v, i) => { monthlyTotals[i] += v }))
      results.push({ year, incidentType, barangayData, monthlyTotals, grandTotal: monthlyTotals.reduce((a, b) => a + b, 0) })
    })
    return results.sort((a, b) => a.year.localeCompare(b.year))
  }

  const barangayData: YearlyBarangayData[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    if (isSkippedRow(cols[0])) continue
    const locationName = cleanLocationName(cols[0]); if (!locationName) continue
    const months: number[] = []
    for (let m = 1; m <= 12; m++) { const v = parseFloat(cols[m] ?? '0'); months.push(isNaN(v) ? 0 : v) }
    const total = months.reduce((a, b) => a + b, 0)
    if (total > 0) barangayData.push({ barangay: locationName, months, total })
  }
  const monthlyTotals = Array(12).fill(0)
  barangayData.forEach(b => b.months.forEach((v, i) => { monthlyTotals[i] += v }))
  return [{ year: 'Unknown', incidentType, barangayData, monthlyTotals, grandTotal: monthlyTotals.reduce((a, b) => a + b, 0) }]
}

function datasetKey(d: YearDataset) { return `${d.incidentType}::${d.year}` }

// Convert raw Supabase rows → YearDataset[]
function rowsToDatasets(rows: DbDatasetRow[]): YearDataset[] {
  const grouped = new Map<string, { incidentType: IncidentType; year: string; barangayData: YearlyBarangayData[] }>()
  for (const row of rows) {
    const key = `${row.incident_type}::${row.year}`
    if (!grouped.has(key)) grouped.set(key, { incidentType: row.incident_type as IncidentType, year: row.year, barangayData: [] })
    const months = [row.jan, row.feb, row.mar, row.apr, row.may, row.jun, row.jul, row.aug, row.sep, row.oct, row.nov, row.dec]
    grouped.get(key)!.barangayData.push({ barangay: row.location, months, total: row.total })
  }
  const results: YearDataset[] = []
  grouped.forEach(({ incidentType, year, barangayData }) => {
    const monthlyTotals = Array(12).fill(0)
    barangayData.forEach(b => b.months.forEach((v, i) => { monthlyTotals[i] += v }))
    results.push({ year, incidentType, barangayData, monthlyTotals, grandTotal: monthlyTotals.reduce((a, b) => a + b, 0) })
  })
  return results.sort((a, b) => a.incidentType.localeCompare(b.incidentType) || a.year.localeCompare(b.year))
}

// Convert a YearDataset's rows into Supabase upsert payload
function datasetToRows(dataset: YearDataset): DbDatasetRow[] {
  return dataset.barangayData.map(b => ({
    incident_type: dataset.incidentType,
    year: dataset.year,
    location: b.barangay,
    jan: b.months[0], feb: b.months[1], mar: b.months[2], apr: b.months[3],
    may: b.months[4], jun: b.months[5], jul: b.months[6], aug: b.months[7],
    sep: b.months[8], oct: b.months[9], nov: b.months[10], dec: b.months[11],
    total: b.total,
  }))
}

function isUrdanetaData(locations: string[]): boolean {
  if (locations.length === 0) return false
  const barangaySet = new Set(BARANGAYS.map(b => b.toLowerCase()))
  const matched = locations.filter(l => barangaySet.has(l.toLowerCase())).length
  return matched / locations.length >= 0.5
}

// ─── AI Narrative modal ───────────────────────────────────────────────────────

function NarrativeModal({ title, prompt, onClose }: { title: string; prompt: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function generate() {
      try {
        const GROQ_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY
        if (!GROQ_KEY) throw new Error('NEXT_PUBLIC_GROQ_API_KEY is not set')
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', max_tokens: 1000, temperature: 0.4,
            messages: [
              { role: 'system', content: 'You are a data analyst for ResponSight, an emergency response management system in Urdaneta City, Pangasinan, Philippines. Write 3–5 concise prose paragraphs with no headers or bullets. Under 300 words.' },
              { role: 'user', content: prompt },
            ],
          }),
        })
        if (!res.ok) throw new Error(`Groq API error ${res.status}`)
        const data = await res.json()
        if (!cancelled) setText(data.choices?.[0]?.message?.content ?? '')
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? 'Failed to generate insight')
      } finally { if (!cancelled) setLoading(false) }
    }
    generate()
    return () => { cancelled = true }
  }, [prompt])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/15 border border-brand-600/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-brand-400" />
            </div>
            <div><p className="text-sm font-semibold text-text-primary">Chart Insights</p><p className="text-xs text-text-muted">{title}</p></div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="px-6 py-5 min-h-[180px] max-h-[60vh] overflow-y-auto">
          {loading
            ? <div className="flex flex-col items-center justify-center py-10 gap-3"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /><p className="text-xs text-text-muted">Analysing chart data…</p></div>
            : error
              ? <div className="flex items-center gap-2 text-violet-400 text-sm"><X className="w-4 h-4 shrink-0" />{error}</div>
              : <div className="space-y-3">{text.split('\n').filter(p => p.trim()).map((para, i) => <p key={i} className="text-sm text-text-primary leading-relaxed">{para}</p>)}</div>
          }
        </div>
        <div className="px-6 py-3 border-t border-surface-border flex items-center justify-between">
          <p className="text-[11px] text-text-muted flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI-generated · may not be 100% accurate</p>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-surface-muted border border-surface-border transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function InsightsButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600/10 hover:bg-brand-600/20 text-brand-400 border border-brand-600/20 transition-all">
      <Sparkles className="w-3 h-3" /> View Insights
    </button>
  )
}

function ChartHeader({ title, subtitle, onInsights, children }: { title: string; subtitle: string; onInsights?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div><h2 className="text-sm font-semibold text-text-primary">{title}</h2><p className="text-xs text-text-muted mt-0.5">{subtitle}</p></div>
      <div className="flex items-center gap-2">{children}{onInsights && <InsightsButton onClick={onInsights} />}</div>
    </div>
  )
}

// ─── InApp-only: Urdaneta Barangay dropdown ───────────────────────────────────

function BarangayFilter({ counts, value, onChange }: {
  counts: Record<string, number>; value: string | null; onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all
          ${value ? 'bg-brand-600/10 border-brand-600/30 text-brand-400' : 'border-surface-border text-text-muted hover:text-text-secondary'}`}>
        <MapPin className="w-3.5 h-3.5" />
        {value ? `Brgy. ${value}` : 'All Barangays'}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-72 overflow-y-auto bg-surface-card border border-surface-border rounded-xl shadow-2xl py-1">
            <button onClick={() => { onChange(null); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${!value ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}`}>
              <span>All Barangays</span>
              <span className="text-text-muted tabular-nums">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
            </button>
            <div className="h-px bg-surface-border my-1" />
            {BARANGAYS.map(b => (
              <button key={b} onClick={() => { onChange(b); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors
                  ${value === b ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}
                  ${!counts[b] ? 'opacity-40' : ''}`}>
                <span>Brgy. {b}</span>
                <span className="text-text-muted tabular-nums">{counts[b] ?? 0}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Dataset-only: Dynamic Location dropdown ──────────────────────────────────

function LocationFilter({ locations, counts, value, onChange }: {
  locations: string[]; counts: Record<string, number>; value: string | null; onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    if (!search) return locations
    const q = search.toLowerCase()
    return locations.filter(l => l.toLowerCase().includes(q))
  }, [locations, search])

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all
          ${value ? 'bg-brand-600/10 border-brand-600/30 text-brand-400' : 'border-surface-border text-text-muted hover:text-text-secondary'}`}>
        <MapPin className="w-3.5 h-3.5" />
        {value ?? 'All Locations'}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSearch('') }} />
          <div className="absolute left-0 top-full mt-1 z-20 w-60 bg-surface-card border border-surface-border rounded-xl shadow-2xl overflow-hidden">
            <div className="p-2 border-b border-surface-border">
              <input autoFocus type="text" placeholder="Search locations…" value={search} onChange={e => setSearch(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-surface-muted border border-surface-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500/50" />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              <button onClick={() => { onChange(null); setOpen(false); setSearch('') }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${!value ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}`}>
                <span>All Locations</span>
                <span className="text-text-muted tabular-nums">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
              </button>
              <div className="h-px bg-surface-border my-1" />
              {filtered.length === 0
                ? <p className="px-3 py-2 text-xs text-text-muted">No matches</p>
                : filtered.map(loc => (
                  <button key={loc} onClick={() => { onChange(loc); setOpen(false); setSearch('') }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors
                      ${value === loc ? 'text-brand-400 bg-brand-600/10' : 'text-text-secondary hover:bg-surface-muted'}`}>
                    <span>{loc}</span>
                    <span className="text-text-muted tabular-nums">{counts[loc] ?? 0}</span>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ResponseTimeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 rounded-lg">
      <p className="text-[11px] text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-xs" style={{ color: p.color }}>
          {p.name}: {p.value != null ? `${p.value} min` : '—'}
        </p>
      ))}
    </div>
  )
}

// ─── Export modal ─────────────────────────────────────────────────────────────

interface ExportModalProps {
  onClose: () => void
  chartRefs: Record<ChartKey, React.RefObject<HTMLDivElement>>
  chartMeta: Record<ChartKey, { title: string; subtitle: string }>
  chartPrompts: Record<ChartKey, string>
  trendData: any[]; typeData: any[]; statusData: any[]
  respTimeData: any[]; hotspotData: any[]
  allReports: RawReport[]
}

const CHART_ORDER: ChartKey[] = ['trend', 'type', 'status', 'resptime', 'hotspot']

async function fetchInsight(prompt: string): Promise<string> {
  const GROQ_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY; if (!GROQ_KEY) return ''
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 400, temperature: 0.4, messages: [{ role: 'system', content: 'You are a data analyst for ResponSight, an emergency response system in Urdaneta City, Pangasinan, Philippines. Write 2–3 concise prose paragraphs. No headers, no bullets. Under 200 words.' }, { role: 'user', content: prompt }] }),
  })
  if (!res.ok) return ''
  const data = await res.json(); return data.choices?.[0]?.message?.content ?? ''
}

function MiniBarChart({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <BarChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }} barSize={8}>
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function ExportModal({ onClose, chartRefs, chartMeta, chartPrompts, trendData, typeData, statusData, respTimeData, hotspotData, allReports }: ExportModalProps) {
  const [selected, setSelected] = useState<Set<ChartKey>>(new Set(CHART_ORDER))
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [showCsvPrompt, setShowCsvPrompt] = useState(false)

  function toggle(k: ChartKey) { setSelected(prev => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next }) }

  async function handleExport() {
    if (selected.size === 0) return
    setExporting(true)
    try {
      const ordered = CHART_ORDER.filter(k => selected.has(k))
      setProgress('Generating AI insights…')
      const insightMap: Record<string, string> = {}
      await Promise.all(ordered.map(async key => { insightMap[key] = await fetchInsight(chartPrompts[key]) }))
      setProgress('Loading libraries…')
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const PW = pdf.internal.pageSize.getWidth(); const PH = pdf.internal.pageSize.getHeight()
      const PAD = 14; const HEADER_H = 22; const CHART_TOP = HEADER_H + 8
      const CHART_H = (PH - HEADER_H) * 0.52; const INSIGHT_TOP = CHART_TOP + CHART_H + 6; const INSIGHT_H = PH - INSIGHT_TOP - 10
      let first = true
      for (const key of ordered) {
        const el = chartRefs[key].current; if (!el) continue
        setProgress(`Capturing "${chartMeta[key].title}"…`)
        const canvas = await html2canvas(el, { backgroundColor: '#13161e', scale: 2, useCORS: true, logging: false })
        if (!first) pdf.addPage(); first = false
        pdf.setFillColor(13, 15, 22); pdf.rect(0, 0, PW, PH, 'F')
        pdf.setFillColor(19, 22, 30); pdf.rect(0, 0, PW, HEADER_H, 'F')
        pdf.setFillColor(229, 29, 29); pdf.rect(0, 0, 3, HEADER_H, 'F')
        pdf.setTextColor(240, 242, 248); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.text('ResponSight', PAD + 2, 14)
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(139, 147, 168); pdf.text(`Analytics  ·  ${chartMeta[key].title}`, PAD + 46, 14)
        pdf.setFontSize(8); pdf.setTextColor(77, 86, 107); pdf.text(format(new Date(), 'MMM d, yyyy'), PW - PAD, 14, { align: 'right' })
        const ratio = canvas.width / canvas.height; const imgW = Math.min(PW - PAD * 2, CHART_H * ratio)
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (PW - imgW) / 2, CHART_TOP, imgW, Math.min(imgW / ratio, CHART_H))
        pdf.setDrawColor(30, 35, 48); pdf.setLineWidth(0.4); pdf.line(PAD, INSIGHT_TOP - 3, PW - PAD, INSIGHT_TOP - 3)
        pdf.setTextColor(229, 29, 29); pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.text('✦  AI INSIGHTS', PAD, INSIGHT_TOP + 3)
        const insight = insightMap[key] || 'No insight available.'
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(176, 183, 198)
        pdf.text(pdf.splitTextToSize(insight, PW - PAD * 2).slice(0, Math.floor(INSIGHT_H / 4.5) - 2), PAD, INSIGHT_TOP + 9)
        pdf.setFontSize(7); pdf.setTextColor(55, 62, 77)
        pdf.text(chartMeta[key].subtitle, PAD, PH - 4)
        pdf.text('Generated by ResponSight · AI insights may not be 100% accurate', PW - PAD, PH - 4, { align: 'right' })
      }
      setProgress('Saving…'); pdf.save(`responsight-analytics-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
      setExporting(false); setProgress(''); setShowCsvPrompt(true)
    } catch (e: any) { console.error('Export failed:', e); alert(`Export failed: ${e.message}`); setExporting(false); setProgress('') }
  }

  async function handleCsvExport() {
    try {
      const headers = ['ID', 'Date', 'Type', 'Location']
      const rows = allReports.map(r => [r.id, format(new Date(r.created_at), 'yyyy-MM-dd HH:mm:ss'), r.incident_type, r.location])
      const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob); link.download = `responsight-reports-${format(new Date(), 'yyyy-MM-dd')}.csv`; link.click()
      setShowCsvPrompt(false); onClose()
    } catch (e: any) { alert(`CSV export failed: ${e.message}`) }
  }

  if (showCsvPrompt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-sm bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Database className="w-4 h-4 text-blue-400" /></div>
              <div><p className="text-sm font-semibold text-text-primary">Export Reports</p><p className="text-xs text-text-muted">CSV format</p></div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center transition-colors"><X className="w-4 h-4 text-text-muted" /></button>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-text-primary mb-1">Export all incident reports as CSV?</p>
            <p className="text-xs text-text-muted mb-4">Includes {allReports.length} report{allReports.length !== 1 ? 's' : ''} — ID, date, type, location.</p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-muted border border-surface-border transition-colors">Skip</button>
              <button onClick={handleCsvExport} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-2">
                <FileDown className="w-4 h-4" /> Export CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!exporting ? onClose : undefined} />
      <div className="relative w-full max-w-2xl bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center"><FileDown className="w-4 h-4 text-green-400" /></div>
            <div><p className="text-sm font-semibold text-text-primary">Export to PDF</p><p className="text-xs text-text-muted">Select charts to include</p></div>
          </div>
          {!exporting && <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center"><X className="w-4 h-4 text-text-muted" /></button>}
        </div>
        <div className="flex items-center gap-3 px-6 pt-4">
          <span className="text-xs text-text-muted">{selected.size} of {CHART_ORDER.length} selected</span>
          <button onClick={() => setSelected(new Set(CHART_ORDER))} className="text-xs text-brand-400 hover:underline">Select all</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-text-muted hover:underline">Clear</button>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CHART_ORDER.map(key => {
            const isSelected = selected.has(key)
            return (
              <button key={key} onClick={() => toggle(key)} disabled={exporting}
                className={`relative rounded-xl border p-3 text-left transition-all ${isSelected ? 'border-brand-500/50 bg-brand-600/10 ring-1 ring-brand-500/30' : 'border-surface-border bg-surface-muted/50 opacity-60'}`}>
                <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border flex items-center justify-center ${isSelected ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-surface-border'}`}>
                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>
                <p className="text-[11px] font-semibold text-text-primary leading-tight pr-5 mb-0.5">{chartMeta[key].title}</p>
                <p className="text-[10px] text-text-muted leading-tight">{chartMeta[key].subtitle}</p>
              </button>
            )
          })}
        </div>
        <div className="px-6 py-4 border-t border-surface-border flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">Each chart = one landscape A4 page</p>
          <div className="flex items-center gap-2">
            {!exporting && <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-muted border border-surface-border">Cancel</button>}
            <button onClick={handleExport} disabled={exporting || selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 disabled:cursor-not-allowed min-w-[130px] justify-center">
              {exporting ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="truncate max-w-[120px] text-xs">{progress || 'Exporting…'}</span></> : <><FileDown className="w-4 h-4" />Export {selected.size} chart{selected.size !== 1 ? 's' : ''}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Type picker modal ────────────────────────────────────────────────────────

function TypePickerModal({ filename, detectedType, onConfirm, onCancel }: {
  filename: string; detectedType: IncidentType
  onConfirm: (type: IncidentType) => void; onCancel: () => void
}) {
  const [picked, setPicked] = useState<IncidentType>(detectedType)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div><p className="text-sm font-semibold text-text-primary">Select Incident Type</p><p className="text-xs text-text-muted truncate max-w-[220px]">{filename}</p></div>
          <button onClick={onCancel} className="w-8 h-8 rounded-lg hover:bg-surface-muted flex items-center justify-center"><X className="w-4 h-4 text-text-muted" /></button>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-text-muted mb-3">What incident type does this dataset represent?</p>
          <div className="grid grid-cols-3 gap-2">
            {INCIDENT_TYPES.map(t => (
              <button key={t} onClick={() => setPicked(t)}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-xs font-semibold transition-all
                  ${picked === t ? 'border-[var(--tc)] bg-[var(--tc)]/10 text-[var(--tc)]' : 'border-surface-border text-text-muted hover:text-text-secondary'}`}
                style={{ '--tc': TYPE_COLOR[t] } as any}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TYPE_COLOR[t] }} />
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-surface-border flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-muted border border-surface-border">Cancel</button>
          <button onClick={() => onConfirm(picked)} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: TYPE_COLOR[picked] }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ─── Dataset Dropdown ─────────────────────────────────────────────────────────

function DatasetDropdown({ label, activeCount, totalCount, radio, children }: {
  label: string; activeCount: number; totalCount: number; radio?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isFiltered = radio ? activeCount > 0 : activeCount < totalCount

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all
          ${isFiltered ? 'bg-brand-600/10 border-brand-600/30 text-brand-400' : 'border-surface-border text-text-muted hover:text-text-secondary hover:border-brand-500/40'}`}>
        {label}
        {(!radio && activeCount < totalCount) && (
          <span className="px-1.5 py-0.5 rounded bg-surface-muted border border-surface-border text-[10px] text-text-primary tabular-nums">
            {activeCount}/{totalCount}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-48 max-h-72 overflow-y-auto bg-surface-card border border-surface-border rounded-xl shadow-2xl py-1">
            {children}
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATASET TAB — Supabase-persisted
// ═══════════════════════════════════════════════════════════════════════════════

function DatasetTab() {
  const supabase = createClient()

  // ── State ──────────────────────────────────────────────────────────────────
  const [datasets, setDatasets] = useState<YearDataset[]>([])
  const [dbLoading, setDbLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<IncidentType>>(new Set())
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set())
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [aiModal, setAiModal] = useState<{ title: string; prompt: string } | null>(null)
  const [hotspotView, setHotspotView] = useState<'map' | 'chart'>('chart')
  const [confirmClear, setConfirmClear] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<{ text: string; filename: string; detectedType: IncidentType } | null>(null)

  // ── Load from Supabase on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setDbLoading(true)
      try {
        const { data, error } = await supabase
          .from('incident_datasets')
          .select('incident_type, year, location, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, total')
          .order('year', { ascending: true })
        if (error) throw error
        if (!cancelled && data && data.length > 0) {
          const loaded = rowsToDatasets(data as DbDatasetRow[])
          setDatasets(loaded)
          setSelectedTypes(new Set(loaded.map(d => d.incidentType)))
          setSelectedYears(new Set(loaded.map(d => d.year)))
        }
      } catch (e: any) {
        console.error('Failed to load datasets from Supabase:', e)
      } finally {
        if (!cancelled) setDbLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Auto-detect if Urdaneta data to set default hotspot view
  const allLocations = useMemo(() => {
    const set = new Set<string>()
    datasets.forEach(d => d.barangayData.forEach(b => set.add(b.barangay)))
    return [...set].sort()
  }, [datasets])

  const isUrdaneta = useMemo(() => isUrdanetaData(allLocations), [allLocations])
  useEffect(() => { setHotspotView(isUrdaneta ? 'map' : 'chart') }, [isUrdaneta])

  const availableYears = useMemo(() => [...new Set(datasets.map(d => d.year))].sort(), [datasets])
  const availableTypes = useMemo(() => [...new Set(datasets.map(d => d.incidentType))] as IncidentType[], [datasets])

  // ── Merge parsed datasets into state + upsert to Supabase ──────────────────
  async function addDatasets(parsed: YearDataset[]) {
    // Merge into local state
    setDatasets(prev => {
      const existing = new Map(prev.map(d => [datasetKey(d), d]))
      parsed.forEach(d => existing.set(datasetKey(d), d))
      return Array.from(existing.values()).sort((a, b) =>
        a.incidentType.localeCompare(b.incidentType) || a.year.localeCompare(b.year)
      )
    })
    setSelectedTypes(prev => { const n = new Set(prev); parsed.forEach(d => n.add(d.incidentType)); return n })
    setSelectedYears(prev => { const n = new Set(prev); parsed.forEach(d => n.add(d.year)); return n })

    // Upsert to Supabase (onConflict = unique key: incident_type, year, location)
    setSaving(true); setSaveError(null)
    try {
      const rows = parsed.flatMap(datasetToRows)
      // Supabase has a 1000-row upsert limit per call — batch if needed
      const BATCH = 500
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const { error } = await supabase
          .from('incident_datasets')
          .upsert(batch, { onConflict: 'incident_type,year,location' })
        if (error) throw error
      }
    } catch (e: any) {
      console.error('Failed to save datasets:', e)
      setSaveError(`Failed to save: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Clear all dataset rows from Supabase ────────────────────────────────────
  async function clearAllDatasets() {
    setSaving(true); setSaveError(null)
    try {
      const { error } = await supabase.from('incident_datasets').delete().gte('total', 0)
      if (error) throw error
      setDatasets([])
      setSelectedTypes(new Set())
      setSelectedYears(new Set())
      setSelectedLocation(null)
    } catch (e: any) {
      console.error('Failed to clear datasets:', e)
      setSaveError(`Failed to clear: ${e.message}`)
    } finally {
      setSaving(false); setConfirmClear(false)
    }
  }

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.name.endsWith('.csv')) continue
      const text = await file.text()
      setPendingFile({ text, filename: file.name, detectedType: detectIncidentType(file.name) })
      return
    }
  }, [])

  function confirmPendingFile(type: IncidentType) {
    if (!pendingFile) return
    try {
      const parsed = parseIncidentCSV(pendingFile.text, type)
      if (parsed.length > 0) addDatasets(parsed)
      else alert('No data rows found. Check the CSV format.')
    } catch (e) { console.error('CSV parse error:', e) }
    setPendingFile(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }, [handleFiles])

  // ── Derived data for charts ─────────────────────────────────────────────────
  const activeDatasets = useMemo(() =>
    datasets.filter(d => selectedTypes.has(d.incidentType) && selectedYears.has(d.year)),
    [datasets, selectedTypes, selectedYears])

  const singleTypeMode = selectedTypes.size === 1

  const monthlyTrendData = useMemo(() => MONTHS.map((month, i) => {
    const row: Record<string, any> = { month }
    activeDatasets.forEach(d => {
      const key = `${d.incidentType}_${d.year}`
      row[key] = selectedLocation
        ? (d.barangayData.find(b => b.barangay === selectedLocation)?.months[i] ?? 0)
        : d.monthlyTotals[i]
    })
    return row
  }), [activeDatasets, selectedLocation])

  const typeBreakdownData = useMemo(() => {
    const totals: Record<IncidentType, number> = {} as any
    activeDatasets.forEach(d => {
      const val = selectedLocation
        ? (d.barangayData.find(b => b.barangay === selectedLocation)?.total ?? 0)
        : (selectedMonth !== null ? d.monthlyTotals[selectedMonth] : d.grandTotal)
      totals[d.incidentType] = (totals[d.incidentType] ?? 0) + val
    })
    return Object.entries(totals).map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total)
  }, [activeDatasets, selectedLocation, selectedMonth])

  const annualByTypeData = useMemo(() => {
    const yearMap: Record<string, Record<string, number>> = {}
    activeDatasets.forEach(d => {
      if (!yearMap[d.year]) yearMap[d.year] = {}
      const val = selectedLocation
        ? (d.barangayData.find(b => b.barangay === selectedLocation)?.total ?? 0)
        : (selectedMonth !== null ? d.monthlyTotals[selectedMonth] : d.grandTotal)
      yearMap[d.year][d.incidentType] = (yearMap[d.year][d.incidentType] ?? 0) + val
    })
    return Object.entries(yearMap).sort(([a], [b]) => a.localeCompare(b)).map(([year, types]) => ({ year, ...types }))
  }, [activeDatasets, selectedLocation, selectedMonth])

  const locationBreakdownData = useMemo(() => {
    const result: Record<string, Record<string, number>> = {}
    activeDatasets.forEach(d => {
      const key = `${d.incidentType}_${d.year}`
      d.barangayData.forEach(b => {
        if (!result[b.barangay]) result[b.barangay] = {}
        result[b.barangay][key] = selectedMonth !== null ? b.months[selectedMonth] : b.total
      })
    })
    return Object.entries(result)
      .map(([loc, vals]) => ({ barangay: loc, ...vals, total: Object.values(vals).reduce((a, b) => a + b, 0) }))
      .filter(r => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 15)
  }, [activeDatasets, selectedMonth])

  const choroplethCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    activeDatasets.forEach(d => d.barangayData.forEach(b => {
      if (b.barangay.toUpperCase() === 'BYPASS') return
      const val = selectedMonth !== null ? b.months[selectedMonth] : b.total
      counts[b.barangay] = (counts[b.barangay] ?? 0) + val
    }))
    return counts
  }, [activeDatasets, selectedMonth])

  const choroplethLabel = useMemo(() => {
    const typeLabel = [...selectedTypes].map(t => TYPE_LABEL[t]).join(' & ')
    const years = [...selectedYears].sort()
    const yearLabel = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] ?? ''
    return `${typeLabel}${yearLabel ? ` · ${yearLabel}` : ''}${selectedMonth !== null ? ` · ${MONTHS[selectedMonth]}` : ''}`
  }, [selectedTypes, selectedYears, selectedMonth])

  const totalIncidents = useMemo(() => activeDatasets.reduce((sum, d) => {
    const val = selectedLocation
      ? (d.barangayData.find(b => b.barangay === selectedLocation)?.total ?? 0)
      : (selectedMonth !== null ? d.monthlyTotals[selectedMonth] : d.grandTotal)
    return sum + val
  }, 0), [activeDatasets, selectedLocation, selectedMonth])

  const typeTotalsForCards = useMemo(() => {
    const t: Partial<Record<IncidentType, number>> = {}
    activeDatasets.forEach(d => {
      const val = selectedLocation
        ? (d.barangayData.find(b => b.barangay === selectedLocation)?.total ?? 0)
        : (selectedMonth !== null ? d.monthlyTotals[selectedMonth] : d.grandTotal)
      t[d.incidentType] = (t[d.incidentType] ?? 0) + val
    })
    return t
  }, [activeDatasets, selectedLocation, selectedMonth])

  const locationCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    activeDatasets.forEach(d => d.barangayData.forEach(b => { counts[b.barangay] = (counts[b.barangay] ?? 0) + b.total }))
    return counts
  }, [activeDatasets])

  // ── Loading state ───────────────────────────────────────────────────────────
  if (dbLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-7 h-7 text-brand-400 animate-spin" />
        <p className="text-sm text-text-muted">Loading datasets from Supabase…</p>
      </div>
    )
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (datasets.length === 0) {
    return (
      <>
        <div onDrop={handleDrop} onDragOver={e => e.preventDefault()}
          className="flex flex-col items-center justify-center min-h-[400px] border-2 border-dashed border-surface-border rounded-2xl mx-1 transition-colors hover:border-brand-500/50 hover:bg-brand-600/5">
          <div className="w-16 h-16 rounded-2xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center mb-4">
            <Upload className="w-7 h-7 text-brand-400" />
          </div>
          <p className="text-sm font-semibold text-text-primary mb-1">Upload Incident Dataset</p>
          <p className="text-xs text-text-muted mb-2 text-center max-w-sm">Drop a CSV file here or click to browse. Data is saved to Supabase automatically.</p>
          <p className="text-xs text-text-muted mb-6 text-center max-w-sm opacity-60">Accepts any location names · Format: Location, JAN–DEC, TOTAL, YEAR</p>
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors">
            <Upload className="w-4 h-4" /> Choose CSV File
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
        </div>
        {pendingFile && <TypePickerModal filename={pendingFile.filename} detectedType={pendingFile.detectedType} onConfirm={confirmPendingFile} onCancel={() => setPendingFile(null)} />}
      </>
    )
  }

  // ── Main view ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Save status banner */}
      {(saving || saveError) && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs ${saveError ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-brand-600/10 border border-brand-600/30 text-brand-400'}`}>
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving to Supabase…</> : <><X className="w-3.5 h-3.5" />{saveError}</>}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => fileInputRef.current?.click()} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-surface-border text-text-muted hover:text-text-secondary hover:border-brand-500/40 transition-all disabled:opacity-50">
          <Upload className="w-3.5 h-3.5" /> Add Dataset
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />

        {/* ── Type filter dropdown ── */}
        <DatasetDropdown
          label="Type"
          activeCount={selectedTypes.size}
          totalCount={availableTypes.length}
        >
          <div className="px-1 py-1 space-y-0.5">
            <button
              onClick={() => setSelectedTypes(new Set(availableTypes))}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-surface-muted transition-colors flex items-center justify-between"
            >
              <span>Select all</span>
              {selectedTypes.size === availableTypes.length && <Check className="w-3 h-3 text-brand-400" />}
            </button>
            {availableTypes.map(type => {
              const active = selectedTypes.has(type)
              const color  = TYPE_COLOR[type]
              return (
                <button
                  key={type}
                  onClick={() => setSelectedTypes(prev => { const n = new Set(prev); n.has(type) ? n.delete(type) : n.add(type); return n })}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors hover:bg-surface-muted flex items-center gap-2.5"
                >
                  {/* checkbox */}
                  <span
                    className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all"
                    style={active
                      ? { backgroundColor: color, borderColor: color }
                      : { backgroundColor: 'transparent', borderColor: '#1e2330' }}
                  >
                    {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span style={{ color: active ? color : '#8b93a8' }}>{TYPE_LABEL[type]}</span>
                </button>
              )
            })}
          </div>
        </DatasetDropdown>

        {/* ── Year filter dropdown ── */}
        {availableYears.length > 0 && (
          <DatasetDropdown
            label="Year"
            activeCount={selectedYears.size}
            totalCount={availableYears.length}
          >
            <div className="px-1 py-1 space-y-0.5">
              <button
                onClick={() => setSelectedYears(new Set(availableYears))}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-surface-muted transition-colors flex items-center justify-between"
              >
                <span>Select all</span>
                {selectedYears.size === availableYears.length && <Check className="w-3 h-3 text-brand-400" />}
              </button>
              {availableYears.map((year, idx) => {
                const active = selectedYears.has(year)
                const color  = getYearColor(year, idx)
                return (
                  <button
                    key={year}
                    onClick={() => setSelectedYears(prev => { const n = new Set(prev); n.has(year) ? n.delete(year) : n.add(year); return n })}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors hover:bg-surface-muted flex items-center gap-2.5"
                  >
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all"
                      style={active
                        ? { backgroundColor: color, borderColor: color }
                        : { backgroundColor: 'transparent', borderColor: '#1e2330' }}
                    >
                      {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                    </span>
                    <span style={{ color: active ? color : '#8b93a8' }}>{year}</span>
                  </button>
                )
              })}
            </div>
          </DatasetDropdown>
        )}

        {/* ── Month filter dropdown (radio) ── */}
        <DatasetDropdown
          label={selectedMonth !== null ? MONTHS[selectedMonth] : 'Month'}
          activeCount={selectedMonth !== null ? 1 : 0}
          totalCount={12}
          radio
        >
          <div className="px-1 py-1 space-y-0.5">
            <button
              onClick={() => setSelectedMonth(null)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors hover:bg-surface-muted flex items-center gap-2.5"
            >
              {/* radio circle */}
              <span className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all"
                style={selectedMonth === null
                  ? { backgroundColor: '#7c3aed', borderColor: '#7c3aed' }
                  : { borderColor: '#1e2330' }}
              >
                {selectedMonth === null && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span style={{ color: selectedMonth === null ? '#a78bfa' : '#8b93a8' }}>All Months</span>
            </button>
            {MONTHS.map((m, i) => {
              const active = selectedMonth === i
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMonth(i)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs transition-colors hover:bg-surface-muted flex items-center gap-2.5"
                >
                  <span
                    className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all"
                    style={active
                      ? { backgroundColor: '#7c3aed', borderColor: '#7c3aed' }
                      : { borderColor: '#1e2330' }}
                  >
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </span>
                  <span style={{ color: active ? '#a78bfa' : '#8b93a8' }}>{m}</span>
                </button>
              )
            })}
          </div>
        </DatasetDropdown>

        <LocationFilter locations={allLocations} counts={locationCounts} value={selectedLocation} onChange={setSelectedLocation} />

        {selectedLocation && <button onClick={() => setSelectedLocation(null)} className="text-xs text-brand-400 hover:underline">Clear location</button>}

        {/* Clear all button — right side */}
        <div className="ml-auto">
          {confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete all dataset rows?</span>
              <button onClick={clearAllDatasets} disabled={saving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmClear(false)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-secondary border border-surface-border transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmClear(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-red-900/40 text-red-400/70 hover:text-red-400 hover:border-red-500/50 hover:bg-red-500/5 transition-all">
              <Trash2 className="w-3.5 h-3.5" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="glass rounded-xl p-4 col-span-2 md:col-span-1">
          <p className="text-xs text-text-muted">Total{selectedLocation ? ` · ${selectedLocation}` : ''}</p>
          <p className="text-2xl font-bold mt-1 text-text-primary">{totalIncidents.toLocaleString()}</p>
          <p className="text-[10px] text-text-muted mt-0.5">{selectedYears.size} yr · {selectedTypes.size} type{selectedTypes.size !== 1 ? 's' : ''}</p>
        </div>
        {(Object.entries(typeTotalsForCards) as [IncidentType, number][]).sort((a, b) => b[1] - a[1]).map(([type, total]) => (
          <div key={type} className="glass rounded-xl p-4" style={{ borderColor: `${TYPE_COLOR[type]}30` }}>
            <p className="text-xs" style={{ color: TYPE_COLOR[type] }}>{TYPE_LABEL[type]}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: TYPE_COLOR[type] }}>{total.toLocaleString()}</p>
            <p className="text-[10px] text-text-muted mt-0.5">incidents</p>
          </div>
        ))}
      </div>

      {/* Chart 1: Monthly trend */}
      <div className="glass rounded-xl p-5">
        <ChartHeader
          title={`Monthly Incident Trend${selectedLocation ? ` · ${selectedLocation}` : ''}`}
          subtitle={`${selectedMonth !== null ? MONTHS[selectedMonth] : 'All months'} · ${[...selectedYears].sort().join(', ') || 'No years selected'}${singleTypeMode ? ' · colored by year' : ''}`}
          onInsights={() => setAiModal({ title: 'Monthly Incident Trend', prompt: `Monthly incident trend${selectedLocation ? ` for ${selectedLocation}` : ''}:\n${monthlyTrendData.map(d => { const vals = activeDatasets.map(ds => `${ds.incidentType} ${ds.year}=${d[`${ds.incidentType}_${ds.year}`] ?? 0}`).join(', '); return `${d.month}: ${vals}` }).join('\n')}` })}
        />
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthlyTrendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
            <XAxis dataKey="month" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={LEGEND_STYLE} />
            {activeDatasets.map((d, dsIdx) => {
              const key = `${d.incidentType}_${d.year}`
              const yearIdx = availableYears.indexOf(d.year)
              const lineColor = singleTypeMode ? getYearColor(d.year, yearIdx) : (TYPE_COLOR[d.incidentType] ?? '#6b7280')
              return (
                <Line key={key} type="monotone" dataKey={key} name={`${TYPE_LABEL[d.incidentType]} ${d.year}`}
                  stroke={lineColor} strokeWidth={2}
                  dot={{ r: 3, fill: lineColor }} activeDot={{ r: 5 }}
                  strokeDasharray={!singleTypeMode && yearIdx % 2 === 1 ? '5 3' : undefined} />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Charts 2 + 3 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="glass rounded-xl p-5">
          <ChartHeader
            title={`Incidents by Type${selectedLocation ? ` · ${selectedLocation}` : ''}`}
            subtitle={selectedMonth !== null ? `${MONTHS[selectedMonth]} only · all active years` : 'Full period · all active years'}
            onInsights={() => setAiModal({ title: 'Incidents by Type', prompt: `Incident type breakdown${selectedLocation ? ` for ${selectedLocation}` : ''}${selectedMonth !== null ? `, ${MONTHS[selectedMonth]}` : ''}:\n${typeBreakdownData.map(d => `${d.type}: ${d.total}`).join('\n')}` })}
          />
          {typeBreakdownData.length === 0
            ? <div className="h-[200px] flex items-center justify-center text-sm text-text-muted">No data</div>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={typeBreakdownData} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                  <XAxis dataKey="type" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => TYPE_LABEL[v] ?? v} />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#1e2330' }} />
                  <Bar dataKey="total" name="Incidents" radius={[4, 4, 0, 0]}>
                    {typeBreakdownData.map(d => <Cell key={d.type} fill={TYPE_COLOR[d.type] ?? TYPE_COLOR.other} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
        <div className="glass rounded-xl p-5">
          <ChartHeader
            title={`Annual Totals by Type${selectedLocation ? ` · ${selectedLocation}` : ''}`}
            subtitle={selectedMonth !== null ? `${MONTHS[selectedMonth]} only` : 'Full year'}
            onInsights={() => setAiModal({ title: 'Annual Totals by Type', prompt: `Annual totals by type${selectedLocation ? ` for ${selectedLocation}` : ''}:\n${annualByTypeData.map(d => { const parts = [...selectedTypes].map(t => `${t}=${(d as any)[t] ?? 0}`); return `${d.year}: ${parts.join(', ')}` }).join('\n')}` })}
          />
          {annualByTypeData.length === 0
            ? <div className="h-[220px] flex items-center justify-center text-sm text-text-muted">No data</div>
            : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={annualByTypeData} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                  <XAxis dataKey="year" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#1e2330' }} />
                  <Legend wrapperStyle={LEGEND_STYLE} />
                  {[...selectedTypes].map(type => (
                    <Bar key={type} dataKey={type} name={TYPE_LABEL[type]} fill={TYPE_COLOR[type]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
      </div>

      {/* Chart 4: Locations / Choropleth */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {isUrdaneta && hotspotView === 'map'
                ? `Barangay Choropleth${selectedMonth !== null ? ` · ${MONTHS[selectedMonth]}` : ''}`
                : `Top Locations by Incidents${selectedMonth !== null ? ` · ${MONTHS[selectedMonth]}` : ''}`}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              {isUrdaneta && hotspotView === 'map'
                ? `${choroplethLabel} · Bypass excluded from map`
                : `${[...selectedTypes].map(t => TYPE_LABEL[t]).join(', ')} · ${[...selectedYears].sort().join(', ')} · top 15`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isUrdaneta && (
              <div className="flex items-center gap-1 p-1 bg-surface-muted rounded-lg border border-surface-border">
                <button onClick={() => setHotspotView('map')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotView === 'map' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                  <MapIcon className="w-3 h-3" /> Map
                </button>
                <button onClick={() => setHotspotView('chart')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotView === 'chart' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                  <BarChartIcon className="w-3 h-3" /> Chart
                </button>
              </div>
            )}
            <InsightsButton onClick={() => setAiModal({ title: isUrdaneta && hotspotView === 'map' ? 'Barangay Choropleth' : 'Top Locations', prompt: `Top locations by incident count${selectedMonth !== null ? `, ${MONTHS[selectedMonth]}` : ''}:\n${locationBreakdownData.slice(0, 10).map(d => { const parts = activeDatasets.map(ds => `${ds.incidentType} ${ds.year}=${(d as any)[`${ds.incidentType}_${ds.year}`] ?? 0}`); return `${d.barangay}: ${parts.join(', ')}` }).join('\n')}` })} />
          </div>
        </div>

        {isUrdaneta && hotspotView === 'map' ? (
          <div className="relative w-full h-[420px] rounded-xl overflow-hidden border border-surface-border">
            <DatasetChoroplethMap counts={choroplethCounts} label={choroplethLabel} />
          </div>
        ) : locationBreakdownData.length === 0 ? (
          <div className="h-[340px] flex items-center justify-center text-sm text-text-muted">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(280, locationBreakdownData.length * 24)}>
            <BarChart data={locationBreakdownData} layout="vertical" barSize={8} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="barangay" width={130} tick={{ fill: '#8892a4', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#1e2330' }} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              {activeDatasets.map((d) => {
                const key = `${d.incidentType}_${d.year}`
                const yearIdx = availableYears.indexOf(d.year)
                const barColor = singleTypeMode ? getYearColor(d.year, yearIdx) : (TYPE_COLOR[d.incidentType] ?? '#6b7280')
                return <Bar key={key} dataKey={key} name={`${TYPE_LABEL[d.incidentType]} ${d.year}`} fill={barColor} radius={[0, 3, 3, 0]} />
              })}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {aiModal && <NarrativeModal title={aiModal.title} prompt={aiModal.prompt} onClose={() => setAiModal(null)} />}
      {pendingFile && <TypePickerModal filename={pendingFile.filename} detectedType={pendingFile.detectedType} onConfirm={confirmPendingFile} onCancel={() => setPendingFile(null)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// IN-APP TAB
// ═══════════════════════════════════════════════════════════════════════════════

function InAppTab() {
  const supabase = createClient()
  const [allReports, setAllReports] = useState<RawReport[]>([])
  const [loading, setLoading] = useState(true)
  const [barangay, setBarangay] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState({ start: format(subDays(new Date(), 7), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') })
  const [modal, setModal] = useState<ChartKey | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [hotspotView, setHotspotView] = useState<'map' | 'chart'>('map')
  const [hotspotDataSource, setHotspotDataSource] = useState<'live' | 'historical'>('live')
  const [trendType, setTrendType] = useState<string | null>(null)

  const refTrend = useRef<HTMLDivElement>(null); const refType = useRef<HTMLDivElement>(null)
  const refStatus = useRef<HTMLDivElement>(null); const refRespTime = useRef<HTMLDivElement>(null)
  const refHotspot = useRef<HTMLDivElement>(null)
  const chartRefs: Record<ChartKey, React.RefObject<HTMLDivElement>> = { trend: refTrend, type: refType, status: refStatus, resptime: refRespTime, hotspot: refHotspot }

  useEffect(() => {
    fetchAll()
    let timer: ReturnType<typeof setTimeout>
    function scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => { try { sessionStorage.removeItem('rs_analytics_cache') } catch (_) { }; fetchAll() }, 2000) }
    const ch = supabase.channel('analytics-reports').on('postgres_changes', { event: '*', schema: 'public', table: 'incident_reports' }, scheduleRefresh).subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(ch) }
  }, [])

  async function fetchAll() {
    const CACHE_KEY = 'rs_analytics_cache'; const CACHE_TTL = 2 * 60 * 1000
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (raw) {
        const { ts, data } = JSON.parse(raw)
        if (Date.now() - ts < CACHE_TTL) {
          setAllReports(data); setLoading(false)
          supabase.from('incident_reports').select('id, created_at, incident_type, severity, status, location, response_time_minutes, latitude, longitude').order('created_at', { ascending: false }).limit(500)
            .then(({ data: fresh }) => { if (fresh?.length) { const mapped = fresh.map((r: any) => ({ ...r, location: r.location ?? '' })); setAllReports(mapped); sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: mapped })) } })
          return
        }
      }
    } catch (_) { }
    setLoading(true)
    try {
      const { data: reports } = await supabase.from('incident_reports').select('id, created_at, incident_type, severity, status, location, response_time_minutes, latitude, longitude').order('created_at', { ascending: false }).limit(500)
      if (reports?.length) { const mapped = reports.map((r: any) => ({ ...r, location: r.location ?? '' })); setAllReports(mapped); try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: mapped })) } catch (_) { } }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const barangayCounts = useMemo(() => { const counts: Record<string, number> = {}; allReports.forEach(r => { const b = extractBarangay(r.location); if (b) counts[b] = (counts[b] ?? 0) + 1 }); return counts }, [allReports])
  const reports = useMemo(() => barangay ? allReports.filter(r => extractBarangay(r.location) === barangay) : allReports, [allReports, barangay])

  const trendData = useMemo(() => {
    const start = new Date(dateRange.start); const end = new Date(dateRange.end)
    const numDays = Math.max(1, differenceInDays(end, start) + 1)
    const recent = reports.filter(r => { const d = new Date(r.created_at); return d >= startOfDay(start) && d <= endOfDay(end) })
    const days = Array.from({ length: numDays }, (_, i) => { const d = addDays(startOfDay(start), i); return { date: format(d, 'MMM d'), day: format(startOfDay(d), 'yyyy-MM-dd'), fire: 0, flood: 0, accident: 0, medical: 0, crime: 0, other: 0 } })
    recent.forEach(r => { const bucket = days.find(d => d.day === format(new Date(r.created_at), 'yyyy-MM-dd')); if (bucket) { const rawType = (r.incident_type || 'other').toLowerCase(); const type = rawType in bucket ? rawType : 'other'; (bucket as any)[type]++ } })
    return days
  }, [reports, dateRange])

  const typeData = useMemo(() => { const counts: Record<string, number> = {}; reports.forEach(r => { const type = (r.incident_type || 'other').toLowerCase(); counts[type] = (counts[type] ?? 0) + 1 }); return Object.entries(counts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count) }, [reports])
  const statusData = useMemo(() => { const counts: Record<string, number> = {}; reports.forEach(r => { counts[r.status] = (counts[r.status] ?? 0) + 1 }); return Object.entries(counts).map(([status, count]) => ({ status, count })) }, [reports])

  const respTimeData = useMemo(() => {
    const start = new Date(dateRange.start); const end = new Date(dateRange.end)
    const numDays = Math.max(1, differenceInDays(end, start) + 1)
    const withTime = allReports.filter(r => { if (r.response_time_minutes == null) return false; const d = new Date(r.created_at); return d >= startOfDay(start) && d <= endOfDay(end) })
    const days = Array.from({ length: numDays }, (_, i) => { const d = addDays(startOfDay(start), i); return { date: format(d, 'MMM d'), day: format(startOfDay(d), 'yyyy-MM-dd'), sum: 0, count: 0 } })
    withTime.forEach(r => { const bucket = days.find(d => d.day === format(new Date(r.created_at), 'yyyy-MM-dd')); if (bucket) { bucket.sum += r.response_time_minutes!; bucket.count++ } })
    return days.map(d => ({ date: d.date, avg: d.count > 0 ? Math.round(d.sum / d.count * 10) / 10 : null, count: d.count }))
  }, [allReports, dateRange])

  const overallAvgRt = useMemo(() => { const valid = allReports.filter(r => r.response_time_minutes != null); if (!valid.length) return null; return Math.round(valid.reduce((s, r) => s + r.response_time_minutes!, 0) / valid.length * 10) / 10 }, [allReports])
  const hotspotData = useMemo(() => { const counts: Record<string, number> = {}; allReports.forEach(r => { const b = extractBarangay(r.location); if (b) counts[b] = (counts[b] ?? 0) + 1 }); return Object.entries(counts).map(([barangay, count]) => ({ barangay, count })).sort((a, b) => b.count - a.count).slice(0, 12) }, [allReports])

  const choroplethIncidents = useMemo((): MapIncident[] => {
    const source = hotspotDataSource === 'live' ? allReports.filter(r => ['pending', 'verified', 'responding'].includes(r.status)) : allReports
    return source.map(r => ({ id: r.id, incident_type: (r.incident_type || 'other').toLowerCase(), title: `${(r.incident_type || 'other').charAt(0).toUpperCase() + (r.incident_type || 'other').slice(1).toLowerCase()} — ${r.location}`, location: r.location, status: r.status, severity: r.severity, created_at: r.created_at, latitude: r.latitude ?? null, longitude: r.longitude ?? null, responder_name: null }))
  }, [allReports, hotspotDataSource])

  const chartMeta: Record<ChartKey, { title: string; subtitle: string }> = {
    trend: { title: 'Incident Trend', subtitle: `${dateRange.start} to ${dateRange.end}${barangay ? ` · Brgy. ${barangay}` : ''}` },
    type: { title: 'Incidents by Type', subtitle: `All time${barangay ? ` · Brgy. ${barangay}` : ''}` },
    status: { title: 'Incidents by Status', subtitle: `All time${barangay ? ` · Brgy. ${barangay}` : ''}` },
    resptime: { title: 'Avg. Response Time', subtitle: 'Daily average minutes · acceptance → completion' },
    hotspot: { title: 'Hotspots by Barangay', subtitle: 'Top 12 barangays · all time' },
  }

  const brgyCtx = barangay ? `Filtered to Brgy. ${barangay} only.` : 'All barangays combined.'
  const trendTypeCtx = trendType ? `Filtered to type: ${TYPE_LABEL[trendType] ?? trendType}.` : 'All incident types.'
  const trendPrompt = `Incident trend ${dateRange.start} to ${dateRange.end}. ${brgyCtx} ${trendTypeCtx}\n${trendData.map(d => `${d.date}: fire=${d.fire} flood=${d.flood} accident=${d.accident} medical=${d.medical} crime=${d.crime} other=${d.other}`).join('\n')}`
  const typePrompt = `Type breakdown. ${brgyCtx}\n${typeData.map(d => `${d.type}: ${d.count}`).join('\n')}`
  const statusPrompt = `Status breakdown. ${brgyCtx}\n${statusData.map(d => `${d.status}: ${d.count}`).join('\n')}`
  const respTimePrompt = `Response time trend ${dateRange.start} to ${dateRange.end}. Overall avg: ${overallAvgRt ?? 'N/A'} min.\n${respTimeData.map(d => `${d.date}: ${d.avg ?? 'null'} min`).join('\n')}`
  const hotspotPrompt = `Hotspots:\n${hotspotData.map((d, i) => `${i + 1}. Brgy. ${d.barangay}: ${d.count}`).join('\n')}`
  const modalConfig: Record<ChartKey, { title: string; prompt: string }> = { trend: { title: chartMeta.trend.title, prompt: trendPrompt }, type: { title: chartMeta.type.title, prompt: typePrompt }, status: { title: chartMeta.status.title, prompt: statusPrompt }, resptime: { title: chartMeta.resptime.title, prompt: respTimePrompt }, hotspot: { title: chartMeta.hotspot.title, prompt: hotspotPrompt } }
  const noData = <div className="h-48 flex items-center justify-center text-sm text-text-muted">No data{barangay ? ` for Brgy. ${barangay}` : ''}</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <BarangayFilter counts={barangayCounts} value={barangay} onChange={setBarangay} />
          {barangay && (<><button onClick={() => setBarangay(null)} className="text-xs text-brand-400 hover:underline">Clear</button><span className="text-xs text-text-muted">{reports.length} of {allReports.length} incidents</span></>)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="px-2 py-1.5 rounded-lg text-xs font-medium border border-surface-border bg-surface-muted text-text-secondary focus:outline-none focus:border-brand-500/50" />
            <span className="text-text-muted text-xs">to</span>
            <input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="px-2 py-1.5 rounded-lg text-xs font-medium border border-surface-border bg-surface-muted text-text-secondary focus:outline-none focus:border-brand-500/50" />
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-green-500/10 border-green-500/20 text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Live
          </div>
          <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 transition-all">
            <FileDown className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>
      </div>

      <div ref={refTrend} className="glass rounded-xl p-5">
        <ChartHeader title="Incident Trend" subtitle={`${dateRange.start} to ${dateRange.end}${barangay ? ` · Brgy. ${barangay}` : ''}`} onInsights={() => setModal('trend')}>
          <div className="relative">
            <select value={trendType ?? ''} onChange={e => setTrendType(e.target.value === '' ? null : e.target.value)} className="appearance-none pl-3 pr-7 py-1.5 rounded-lg text-xs font-medium border border-surface-border bg-surface-muted text-text-secondary focus:outline-none focus:border-brand-500/50">
              <option value="">All Types</option>
              {INCIDENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
          </div>
        </ChartHeader>
        {loading ? <div className="h-64 flex items-center justify-center text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div> : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData}>
              <defs>
                {[['fire', '#ef4444'], ['flood', '#3b82f6'], ['accident', '#eab308'], ['medical', '#22c55e'], ['crime', '#a855f7'], ['other', '#9ca3af']].map(([k, c]) => (
                  <linearGradient key={k} id={k} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={c} stopOpacity={0.3} /><stop offset="95%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
              <XAxis dataKey="date" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} /><Legend wrapperStyle={LEGEND_STYLE} />
              {(!trendType || trendType === 'fire') && <Area type="monotone" dataKey="fire" name="Fire" stroke="#ef4444" fill="url(#fire)" strokeWidth={2} dot={false} />}
              {(!trendType || trendType === 'flood') && <Area type="monotone" dataKey="flood" name="Flood" stroke="#3b82f6" fill="url(#flood)" strokeWidth={2} dot={false} />}
              {(!trendType || trendType === 'accident') && <Area type="monotone" dataKey="accident" name="Accident" stroke="#eab308" fill="url(#accident)" strokeWidth={2} dot={false} />}
              {(!trendType || trendType === 'medical') && <Area type="monotone" dataKey="medical" name="Medical" stroke="#22c55e" fill="url(#medical)" strokeWidth={2} dot={false} />}
              {(!trendType || trendType === 'crime') && <Area type="monotone" dataKey="crime" name="Crime" stroke="#a855f7" fill="url(#crime)" strokeWidth={2} dot={false} />}
              {(!trendType || trendType === 'other') && <Area type="monotone" dataKey="other" name="Other" stroke="#9ca3af" fill="url(#other)" strokeWidth={2} dot={false} />}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div ref={refType} className="glass rounded-xl p-5">
          <ChartHeader title="Incidents by Type" subtitle={`All time${barangay ? ` · Brgy. ${barangay}` : ''}`} onInsights={() => setModal('type')} />
          {loading ? <div className="h-48 flex items-center justify-center text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
            : typeData.length === 0 ? noData : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={typeData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                  <XAxis dataKey="type" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e2330' }} /><Legend wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="count" name="Incidents" radius={[4, 4, 0, 0]}>{typeData.map(d => <Cell key={d.type} fill={TYPE_COLOR[d.type] ?? TYPE_COLOR.other} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
        <div ref={refStatus} className="glass rounded-xl p-5">
          <ChartHeader title="Incidents by Status" subtitle={`All time${barangay ? ` · Brgy. ${barangay}` : ''}`} onInsights={() => setModal('status')} />
          {loading ? <div className="h-48 flex items-center justify-center text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
            : statusData.length === 0 ? noData : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statusData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                  <XAxis dataKey="status" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e2330' }} /><Legend wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="count" name="Incidents" radius={[4, 4, 0, 0]}>{statusData.map(d => <Cell key={d.status} fill={STATUS_COLOR[d.status] ?? '#6b7280'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
        </div>
      </div>

      <div ref={refRespTime} className="glass rounded-xl p-5">
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Clock className="w-4 h-4 text-text-muted" />
              <h2 className="text-sm font-semibold text-text-primary">Avg. Response Time</h2>
              {overallAvgRt != null && <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium">{overallAvgRt} min overall</span>}
            </div>
            <p className="text-xs text-text-muted">Daily average minutes from acceptance → completion</p>
          </div>
          <InsightsButton onClick={() => setModal('resptime')} />
        </div>
        {loading ? <div className="h-64 flex items-center justify-center text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          : respTimeData.every(d => d.avg == null)
            ? <div className="h-64 flex items-center justify-center text-sm text-text-muted">No resolved incidents with response time data yet</div>
            : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={respTimeData}>
                  <defs><linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} /><stop offset="95%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                  <XAxis dataKey="date" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} unit=" min" />
                  <Tooltip content={<ResponseTimeTooltip />} /><Legend wrapperStyle={LEGEND_STYLE} />
                  <Area type="monotone" dataKey="avg" name="Avg response (min)" stroke="#06b6d4" fill="url(#rtGrad)" strokeWidth={2} dot={{ fill: '#06b6d4', r: 3 }} activeDot={{ r: 5 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            )}
      </div>

      <div ref={refHotspot} className="glass rounded-xl p-5">
        <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Incident Hotspots by Barangay</h2>
            <p className="text-xs text-text-muted mt-0.5">{hotspotView === 'map' ? (hotspotDataSource === 'live' ? 'Live active incidents mapped per barangay' : 'All historical incidents mapped per barangay') : 'Top 12 barangays by total report count · all time'}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hotspotView === 'map' && (
              <div className="flex items-center gap-1 p-1 bg-surface-muted rounded-lg border border-surface-border">
                <button onClick={() => setHotspotDataSource('live')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotDataSource === 'live' ? 'bg-green-600/20 text-green-400 border border-green-600/30' : 'text-text-muted hover:text-text-secondary'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${hotspotDataSource === 'live' ? 'bg-green-400 animate-pulse' : 'bg-surface-border'}`} />Live
                </button>
                <button onClick={() => setHotspotDataSource('historical')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotDataSource === 'historical' ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30' : 'text-text-muted hover:text-text-secondary'}`}>Historical</button>
              </div>
            )}
            <div className="flex items-center gap-1 p-1 bg-surface-muted rounded-lg border border-surface-border">
              <button onClick={() => setHotspotView('map')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotView === 'map' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}><MapIcon className="w-3 h-3" /> Map</button>
              <button onClick={() => setHotspotView('chart')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${hotspotView === 'chart' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}><BarChartIcon className="w-3 h-3" /> Chart</button>
            </div>
            <InsightsButton onClick={() => setModal('hotspot')} />
          </div>
        </div>
        {loading ? <div className="h-[420px] flex items-center justify-center text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          : hotspotView === 'map' ? (
            <div className="relative w-full h-[420px] rounded-xl overflow-hidden border border-surface-border"><ChoroplethMap incidents={choroplethIncidents} /></div>
          ) : hotspotData.length === 0 ? <div className="h-[420px] flex items-center justify-center text-sm text-text-muted">No location data available</div>
            : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={hotspotData} layout="vertical" barSize={14} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#4d566b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="barangay" width={110} tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `Brgy. ${v}`} />
                  <Tooltip content={<CustomTooltip formatter={(v: any) => [`${v} incident${v !== 1 ? 's' : ''}`, 'Count']} />} cursor={{ fill: '#1e2330' }} />
                  <Legend wrapperStyle={LEGEND_STYLE} payload={[{ value: '#1 Hotspot', type: 'square', color: '#ef4444' }, { value: 'Top 3', type: 'square', color: '#f97316' }, { value: 'Top 6', type: 'square', color: '#eab308' }, { value: 'Others', type: 'square', color: '#3b82f6' }]} />
                  <Bar dataKey="count" name="Incidents" radius={[0, 4, 4, 0]}>
                    {hotspotData.map((d, i) => <Cell key={d.barangay} fill={i === 0 ? '#ef4444' : i <= 2 ? '#f97316' : i <= 5 ? '#eab308' : '#3b82f6'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
      </div>

      {modal && <NarrativeModal title={modalConfig[modal].title} prompt={modalConfig[modal].prompt} onClose={() => setModal(null)} />}
      {showExport && (
        <ExportModal onClose={() => setShowExport(false)} chartRefs={chartRefs} chartMeta={chartMeta}
          chartPrompts={{ trend: trendPrompt, type: typePrompt, status: statusPrompt, resptime: respTimePrompt, hotspot: hotspotPrompt }}
          trendData={trendData} typeData={typeData} statusData={statusData} respTimeData={respTimeData} hotspotData={hotspotData} allReports={allReports} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<'inapp' | 'dataset'>('inapp')
  return (
    <AppShell>
      <TopBar title="Analytics" subtitle="Incident trends, performance, and historical dataset analysis" />
      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-center gap-1 p-1 bg-surface-muted rounded-xl border border-surface-border w-fit mb-6">
          <button onClick={() => setActiveTab('inapp')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'inapp' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <BarChart2 className="w-4 h-4" /> In-App Data
          </button>
          <button onClick={() => setActiveTab('dataset')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'dataset' ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
            <Database className="w-4 h-4" /> Upload Dataset
          </button>
        </div>
        {activeTab === 'inapp' ? <InAppTab /> : <DatasetTab />}
      </main>
    </AppShell>
  )
}
