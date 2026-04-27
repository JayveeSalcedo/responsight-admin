/**
 * Lexicon-based sentiment analyser for citizen feedback text.
 * Used as an INSTANT fallback when the Python sentiment service is offline.
 *
 * For real analysis, the feedback page calls /api/analyze-sentiment which
 * proxies to the FastAPI service running multilingual XLM-RoBERTa + go_emotions.
 *
 * Entry points:
 *   detectLanguage(text)                    — 'english' | 'tagalog' | 'taglish'
 *   computeSentiment(rating, text)          — instant, lexicon only (no network)
 *   computeSentimentBatch(items)            — batch ML model call, lexicon fallback
 */

import type { SentimentLabel, DetectedLanguage } from '@/types'

// ─── Language detection (mirrors the Python heuristic) ───────────────────────

const TAGALOG_MARKERS = new Set([
  'ang','ng','sa','na','ay','at','mga','ko','mo','namin','nila',
  'siya','sila','kami','kayo','ito','iyon','dito','doon','hindi',
  'huwag','wala','walang','mayroon','may','pero','kasi','dahil',
  'kung','kapag','para','lang','din','rin','naman','po','opo',
  'ba','nga','eh','yung','yun','daw','raw','pa','pala',
  'magaling','mabilis','matagal','masama','maganda','pangit',
  'mabuti','ayos','galing','husay','salamat','natuwa','galit',
  'masaya','malungkot','takot','nakakainis','nakatulong',
  'sobrang','napaka','talaga','grabe','kadiri','bastos',
  'kawawa','masakit','bilis','tagal','responde','dumating','pumunta',
])

const ENGLISH_MARKERS = new Set([
  'the','a','an','is','was','were','are','been','have','has',
  'this','that','they','their','with','for','not','very','so',
  'but','and','or','it','its','he','she','we','you','i',
])

export function detectLanguage(text: string): DetectedLanguage {
  const tokens = new Set(
    text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
  )
  const tlHits = [...tokens].filter(t => TAGALOG_MARKERS.has(t)).length
  const enHits = [...tokens].filter(t => ENGLISH_MARKERS.has(t)).length
  if (tlHits === 0) return 'english'
  if (enHits === 0) return 'tagalog'
  return 'taglish'
}

// ─── Valence lexicons ─────────────────────────────────────────────────────────

const POSITIVE: Record<string, number> = {
  // ── English Strong ──
  excellent: 3, outstanding: 3, exceptional: 3, superb: 3, amazing: 3,
  fantastic: 3, wonderful: 3, brilliant: 3, perfect: 3, lifesaving: 3,
  'life-saving': 3, heroic: 3, commendable: 3, extraordinary: 3,
  // ── English Moderate ──
  great: 2, good: 2, satisfied: 2, happy: 2, pleased: 2, impressed: 2,
  reliable: 2, professional: 2, efficient: 2, effective: 2, helpful: 2,
  responsive: 2, fast: 2, quick: 2, prompt: 2, timely: 2, safe: 2,
  thankful: 2, grateful: 2, appreciate: 2, appreciated: 2, recommend: 2,
  commend: 2, cooperative: 2, dedicated: 2, skilled: 2, courteous: 2,
  // ── English Mild ──
  ok: 1, okay: 1, fine: 1, decent: 1, adequate: 1, acceptable: 1,
  nice: 1, better: 1, improved: 1, improving: 1,

  // ── Tagalog Strong ──
  napakagaling: 3, napakabilis: 3, kahanga_hanga: 3, pinakamahusay: 3,
  napakahusay: 3, pinakamabilis: 3, kamangha_mangha: 3,
  // ── Tagalog Moderate ──
  magaling: 2, mabilis: 2, mahusay: 2, husay: 2, salamat: 2, maganda: 2,
  mabuti: 2, ayos: 2, galing: 2, nakatulong: 2, maayos: 2,
  natuwa: 2, masaya: 2, galak: 2, pasalamat: 2, nagpapasalamat: 2,
  sumasaludo: 2, propesyonal: 2, maaasahan: 2, epektibo: 2, mahiwatig: 2,
  magalang: 2, mainit: 2, maingat: 2, mapagkakatiwalaan: 2,
  nagpapaalala: 1, pumunta: 1, dumating: 1, nagresbonde: 2,
  // ── Tagalog Mild ──
  sige: 1, pwede: 1, naman: 1, medyo: 1,
}

const NEGATIVE: Record<string, number> = {
  // ── English Strong ──
  terrible: 3, horrible: 3, awful: 3, disgraceful: 3, unacceptable: 3,
  disgusting: 3, shameful: 3, useless: 3, incompetent: 3, negligent: 3,
  irresponsible: 3, corrupt: 3, failed: 3, failure: 3, atrocious: 3,
  // ── English Moderate ──
  bad: 2, poor: 2, slow: 2, late: 2, delayed: 2, absent: 2,
  unhelpful: 2, rude: 2, unprofessional: 2, careless: 2,
  inefficient: 2, ineffective: 2, disappointed: 2, disappointing: 2,
  dissatisfied: 2, unsatisfied: 2, wrong: 2, broken: 2, neglected: 2,
  ignored: 2, disrespected: 2, untrained: 2, unresponsive: 2,
  // ── English Mild ──
  mediocre: 1, insufficient: 1, average: 1,

  // ── Tagalog Strong ──
  walang_kwenta: 3, kahiya_hiya: 3, nakakahiya: 3, walang_silbi: 3,
  // ── Tagalog Moderate ──
  pangit: 2, matagal: 2, masama: 2, nakakainis: 2, bastos: 2,
  tamad: 2, pabaya: 2, hindi_maayos: 2, walang_pakialam: 2,
  hindi_dumating: 2, hindi_nagresbonde: 2, bwisit: 2, galit: 2,
  hindi_epektibo: 2, mahina: 2, palpak: 2, sablay: 2,
  // ── Tagalog Mild ──
  medyo_matagal: 1, hindi_okay: 1, kulang: 1, sana: 1,
}

// ─── Emotion lexicons ─────────────────────────────────────────────────────────

const EMOTION_LEXICONS: Record<string, Record<string, number>> = {
  joy: {
    happy: 3, joyful: 3, delighted: 3, ecstatic: 3, thrilled: 3, overjoyed: 3,
    elated: 3, grateful: 3, thankful: 3, blessed: 3, relieved: 3,
    glad: 2, pleased: 2, satisfied: 2, content: 2, cheerful: 2, enjoy: 2,
    enjoyed: 2, enjoying: 2, appreciate: 2, appreciated: 2, love: 2,
    wonderful: 2, great: 2, excellent: 2, amazing: 2, fantastic: 2,
    impressed: 2, recommend: 2, commend: 2,
    nice: 1, good: 1, okay: 1, fine: 1, decent: 1, better: 1,
    // Tagalog
    masaya: 3, natuwa: 3, nagagalak: 3, nagpapasalamat: 3,
    magaling: 2, salamat: 2, galak: 2, saya: 2, galing: 2,
    nakatulong: 2, maayos: 2, napakagaling: 3, husay: 2,
  },
  sadness: {
    devastated: 3, heartbroken: 3, grief: 3, miserable: 3, hopeless: 3,
    depressed: 3, helpless: 3, lost: 3, suffering: 3, tragic: 3,
    sad: 2, disappointed: 2, unhappy: 2, sorry: 2, regret: 2,
    unfortunate: 2, terrible: 2, horrible: 2, awful: 2, poor: 2,
    failed: 2, failure: 2, inadequate: 2, neglected: 2, abandoned: 2,
    upset: 1, down: 1, low: 1, sigh: 1, wish: 1,
    // Tagalog
    malungkot: 3, lungkot: 2, hinagpis: 2, iyak: 2, lumbay: 2,
    napalungkot: 2, kawawa: 2, nakakalungkot: 2, lungkot_na_lungkot: 3,
    nadismaya: 2, nabigo: 2, walang_pag_asa: 3,
  },
  anger: {
    furious: 3, outraged: 3, enraged: 3, livid: 3, infuriated: 3,
    disgusted: 3, corrupt: 3, unacceptable: 3, incompetent: 3, negligent: 3,
    irresponsible: 3, shameful: 3, disgraceful: 3, useless: 3,
    angry: 2, mad: 2, frustrated: 2, annoyed: 2, irritated: 2,
    unhelpful: 2, rude: 2, unprofessional: 2, careless: 2, unfair: 2,
    wasted: 2, wrong: 2, lied: 2, ignored: 2, disrespected: 2,
    bothered: 1, dissatisfied: 1, bad: 1, disappointed: 1,
    // Tagalog
    galit: 3, nagalit: 3, nagagalit: 3, bwisit: 3,
    inis: 2, nakakainis: 2, bastos: 2, pangit: 2, pabaya: 2,
    tamad: 2, walang_pakialam: 2, palpak: 2, sablay: 2,
    hindi: 1, walang: 1, wala: 1,
  },
  fear: {
    terrified: 3, horrified: 3, petrified: 3, panicked: 3, scared: 3,
    afraid: 3, frightened: 3, alarmed: 3, emergency: 3, danger: 3,
    dangerous: 3, threat: 3, death: 3, dying: 3, trapped: 3,
    worried: 2, anxious: 2, nervous: 2, concerned: 2, uncertain: 2,
    unstable: 2, risky: 2, unsafe: 2, critical: 2, severe: 2,
    unsure: 1, uneasy: 1, tense: 1, life: 1,
    // Tagalog
    takot: 3, natakot: 3, natatakot: 3, kinakabahan: 3,
    delikado: 2, mapanganib: 2, nangangamba: 2, nag_aalala: 2,
    baka: 1, hindi_ligtas: 2, panganib: 2,
  },
  disgust: {
    disgusting: 3, revolting: 3, repulsive: 3, nauseating: 3, vile: 3,
    filthy: 3, filth: 3, corrupt: 3, corruption: 3, abhorrent: 3,
    disgusted: 2, gross: 2, horrible: 2, awful: 2, terrible: 2,
    unacceptable: 2, shameful: 2, appalling: 2, offensive: 2,
    deplorable: 2, pathetic: 2, useless: 2, incompetent: 2,
    bad: 1, poor: 1, mediocre: 1, inadequate: 1,
    // Tagalog
    kadiri: 3, nakasusuklam: 3, nakakadiri: 3, nakakainis: 2,
    bastos: 2, kahiya_hiya: 3, nakakahiya: 2, walang_kwenta: 3,
    mahirap: 1, pangit: 2, palpak: 2,
  },
  surprise: {
    shocked: 3, astonished: 3, astounded: 3, stunned: 3, amazed: 3,
    speechless: 3, unexpected: 3, unbelievable: 3, incredible: 3,
    extraordinary: 3, outstanding: 3,
    surprised: 2, wow: 2, remarkable: 2, impressive: 2,
    sudden: 2, quick: 2, fast: 2, instant: 2,
    interesting: 1, unusual: 1, different: 1, changed: 1,
    // Tagalog
    gulat: 3, nagulat: 3, nagugulat: 3,
    akala: 2, biglaan: 2, bigla: 2, grabe: 2, talaga: 1,
    hindi_inaasahan: 3, hindi_akala: 2,
  },
}

// ─── Modifiers ────────────────────────────────────────────────────────────────

const NEGATORS = new Set([
  'not', 'no', 'never', 'neither', 'nor', 'without', "n't",
  'hardly', 'barely', 'scarcely',
  // Tagalog negators
  'hindi', 'huwag', 'wala', 'walang', 'di',
])

const INTENSIFIERS: Record<string, number> = {
  very: 1.5, extremely: 2.0, incredibly: 2.0, absolutely: 2.0, totally: 1.8,
  really: 1.5, so: 1.3, super: 1.5, highly: 1.5, deeply: 1.5,
  utterly: 2.0, completely: 1.8, entirely: 1.8,
  // Tagalog intensifiers
  sobrang: 2.0, napaka: 2.0, talagang: 1.5, grabe: 1.8,
  tunay: 1.5, lubos: 1.8, totoong: 1.5,
}

const DIMINISHERS: Record<string, number> = {
  slightly: 0.5, somewhat: 0.6, kinda: 0.6, fairly: 0.7, quite: 0.8,
  // Tagalog diminishers
  medyo: 0.5, konti: 0.4, bahagya: 0.4, parang: 0.6,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SentimentResult {
  label:      SentimentLabel
  score:      number
  confidence: number
  tokens:     number
  emotions:   Record<string, number>
  language?:  DetectedLanguage   // optional on lexicon results, always set on model results
}

// ─── Core analyser ────────────────────────────────────────────────────────────

export function analyseSentiment(text: string | null | undefined): SentimentResult {
  const empty: SentimentResult = {
    label: 'neutral', score: 0, confidence: 0.5, tokens: 0,
    emotions: { joy: 0, sadness: 0, anger: 0, fear: 0, disgust: 0, surprise: 0 },
  }
  if (!text || text.trim().length < 2) return empty

  const language = detectLanguage(text)
  const lower    = text.toLowerCase()
  const raw      = lower.replace(/[^\w\s']/g, ' ')
  const tokens   = raw.split(/\s+/).filter(Boolean)

  const emotionScores: Record<string, number> = { joy: 0, sadness: 0, anger: 0, fear: 0, disgust: 0, surprise: 0 }
  let valenceScore = 0
  let tokenCount   = 0

  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (NEGATORS.has(tok)) { i++; continue }

    const prev3     = tokens.slice(Math.max(0, i - 3), i)
    const isNegated = prev3.some(t => NEGATORS.has(t))
    const prev2     = tokens.slice(Math.max(0, i - 2), i)
    let modifier    = 1
    for (const m of prev2) {
      if (INTENSIFIERS[m]) { modifier = INTENSIFIERS[m]; break }
      if (DIMINISHERS[m])  { modifier = DIMINISHERS[m];  break }
    }

    let scored = false
    for (const [emotion, lexicon] of Object.entries(EMOTION_LEXICONS)) {
      const val = lexicon[tok] ?? 0
      if (val !== 0) {
        emotionScores[emotion] += (isNegated ? -val : val) * modifier
        scored = true
      }
    }

    const posVal    = POSITIVE[tok] ?? 0
    const negVal    = NEGATIVE[tok] ?? 0
    const wordScore = posVal - negVal
    if (wordScore !== 0) {
      valenceScore += (isNegated ? -wordScore : wordScore) * modifier
      scored = true
    }

    if (scored) tokenCount++
    i++
  }

  const emotionEntries    = Object.entries(emotionScores)
  const topEmotion        = emotionEntries.reduce((best, curr) => curr[1] > best[1] ? curr : best, ['', 0])
  const totalEmotionScore = emotionEntries.reduce((s, [, v]) => s + Math.max(v, 0), 0)

  const normValence = Math.tanh(valenceScore / Math.max(tokenCount, 1))
  let valenceLabel: SentimentLabel
  if      (normValence >=  0.35) valenceLabel = 'positive'
  else if (normValence >= -0.2)  valenceLabel = 'neutral'
  else                            valenceLabel = 'negative'

  let label: SentimentLabel
  if (topEmotion[1] >= 2.0) label = topEmotion[0] as SentimentLabel
  else                       label = valenceLabel

  const maxScore   = Math.max(totalEmotionScore, Math.abs(valenceScore))
  const confidence = Math.min(0.95, 0.45 + Math.min(tokenCount, 6) * 0.025 + Math.min(maxScore, 10) * 0.02)

  return { label, score: valenceScore, confidence, tokens: tokenCount, emotions: emotionScores, language }
}

export interface TokenContribution {
  word:    string
  valence: number
  emotions: Record<string, number>
  negated:  boolean
  modifier: number
}

export function getContributors(text: string): TokenContribution[] {
  if (!text || text.trim().length < 2) return []
  const lower  = text.toLowerCase().replace(/[^\w\s']/g, ' ')
  const tokens = lower.split(/\s+/).filter(Boolean)
  const result: TokenContribution[] = []

  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (NEGATORS.has(tok)) { i++; continue }

    const prev3     = tokens.slice(Math.max(0, i - 3), i)
    const isNegated = prev3.some(t => NEGATORS.has(t))
    const prev2     = tokens.slice(Math.max(0, i - 2), i)
    let modifier    = 1
    for (const m of prev2) {
      if (INTENSIFIERS[m]) { modifier = INTENSIFIERS[m]; break }
      if (DIMINISHERS[m])  { modifier = DIMINISHERS[m];  break }
    }

    const posVal   = POSITIVE[tok] ?? 0
    const negVal   = NEGATIVE[tok] ?? 0
    const valScore = posVal - negVal
    const emotions: Record<string, number> = {}
    let hasEmotion = false

    for (const [emotion, lexicon] of Object.entries(EMOTION_LEXICONS)) {
      const val = lexicon[tok] ?? 0
      if (val !== 0) { emotions[emotion] = (isNegated ? -val : val) * modifier; hasEmotion = true }
    }

    if (valScore !== 0 || hasEmotion) {
      result.push({ word: tok, valence: (isNegated ? -valScore : valScore) * modifier, emotions, negated: isNegated, modifier })
    }
    i++
  }
  return result
}

// ─── Blended analyser (text + star rating) ───────────────────────────────────

export function computeSentiment(rating: number, feedback: string | null): SentimentResult {
  const starScore  = (rating - 3) * 1.5
  const noEmotions = { joy: 0, sadness: 0, anger: 0, fear: 0, disgust: 0, surprise: 0 }

  if (!feedback || feedback.trim().length < 3) {
    let label: SentimentLabel
    if      (rating >= 5) label = 'joy'
    else if (rating >= 4) label = 'positive'
    else if (rating === 3) label = 'neutral'
    else if (rating === 2) label = 'sadness'
    else                   label = 'anger'
    return { label, score: starScore, confidence: 0.65, tokens: 0, emotions: noEmotions }
  }

  const textResult    = analyseSentiment(feedback)
  const emotionEntries = Object.entries(textResult.emotions)
  const topEmotion    = emotionEntries.reduce((best, curr) => curr[1] > best[1] ? curr : best, ['', 0])

  if (topEmotion[1] >= 2.5) return { ...textResult, label: topEmotion[0] as SentimentLabel }

  const blended    = starScore * 0.35 + textResult.score * 0.65
  const normalised = Math.tanh(blended / 2)

  let label: SentimentLabel
  if      (normalised >=  0.5)  label = 'joy'
  else if (normalised >=  0.2)  label = 'positive'
  else if (normalised >= -0.1)  label = 'neutral'
  else if (normalised >= -0.45) label = 'sadness'
  else if (normalised >= -0.7)  label = 'anger'
  else                           label = 'negative'

  return {
    label,
    score:      blended,
    confidence: Math.min(0.95, (textResult.confidence + 0.65) / 2),
    tokens:     textResult.tokens,
    emotions:   textResult.emotions,
    language:   textResult.language,
  }
}

// ─── Model-based analyser (calls FastAPI service) ────────────────────────────

// ModelSentimentResult is defined in @/types — re-export for convenience
export type { ModelSentimentResult } from '@/types'

export async function computeSentimentWithModel(
  rating: number,
  feedback: string | null,
): Promise<ModelSentimentResult> {
  const lexiconBase = computeSentiment(rating, feedback)
  const lang        = feedback ? detectLanguage(feedback) : 'english'

  if (!feedback || feedback.trim().length < 3) {
    return {
      ...lexiconBase,
      source:        'lexicon',
      emotion:       lexiconBase.label,
      emotion_score: lexiconBase.confidence,
      valence:       lexiconBase.label === 'positive' || lexiconBase.label === 'joy' ? 'positive'
                   : lexiconBase.label === 'negative' || lexiconBase.label === 'anger' || lexiconBase.label === 'sadness' ? 'negative'
                   : 'neutral',
      valence_score: lexiconBase.confidence,
      all_emotions:  [],
      language:      lang,
    }
  }

  try {
    const res  = await fetch('/api/analyze-sentiment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: feedback.trim(), rating }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.offline || data.error) throw new Error(data.error ?? 'offline')

    const emotionsMap: Record<string, number> = { joy: 0, sadness: 0, anger: 0, fear: 0, disgust: 0, surprise: 0 }
    for (const e of (data.all_emotions ?? [])) {
      if (e.label in emotionsMap) emotionsMap[e.label] = e.score
    }

    return {
      label:         data.label as SentimentLabel,
      score:         data.valence_score * (data.valence === 'positive' ? 1 : -1),
      confidence:    data.confidence,
      tokens:        feedback.trim().split(/\s+/).length,
      emotions:      emotionsMap,
      source:        'model',
      emotion:       data.emotion,
      emotion_score: data.emotion_score,
      valence:       data.valence,
      valence_score: data.valence_score,
      all_emotions:  data.all_emotions ?? [],
      language:      (data.language ?? lang) as DetectedLanguage,
    }
  } catch {
    return {
      ...lexiconBase,
      source:        'lexicon',
      emotion:       lexiconBase.label,
      emotion_score: lexiconBase.confidence,
      valence:       lexiconBase.score > 0 ? 'positive' : lexiconBase.score < 0 ? 'negative' : 'neutral',
      valence_score: lexiconBase.confidence,
      all_emotions:  [],
      language:      lang,
    }
  }
}

export async function computeSentimentBatch(
  items: { rating: number; feedback: string | null }[],
): Promise<ModelSentimentResult[]> {
  const hasText = items.some(i => i.feedback && i.feedback.trim().length >= 3)

  const lexiconFallback = () => items.map(i => {
    const base = computeSentiment(i.rating, i.feedback)
    const lang = i.feedback ? detectLanguage(i.feedback) : 'english' as DetectedLanguage
    return { ...base, source: 'lexicon' as const, emotion: base.label, emotion_score: base.confidence, valence: 'neutral', valence_score: 0.5, all_emotions: [], language: lang }
  })

  if (!hasText) return lexiconFallback()

  try {
    const res  = await fetch('/api/analyze-sentiment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ items: items.map(i => ({ text: i.feedback?.trim() ?? '', rating: i.rating })) }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (data.offline || data.error) throw new Error(data.error ?? 'offline')

    return (data.results as any[]).map((r, idx) => {
      const emotionsMap: Record<string, number> = { joy: 0, sadness: 0, anger: 0, fear: 0, disgust: 0, surprise: 0 }
      for (const e of (r.all_emotions ?? [])) {
        if (e.label in emotionsMap) emotionsMap[e.label] = e.score
      }
      const fb   = items[idx].feedback
      const lang = (r.language ?? (fb ? detectLanguage(fb) : 'english')) as DetectedLanguage
      return {
        label:         r.label         as SentimentLabel,
        score:         r.valence_score * (r.valence === 'positive' ? 1 : -1),
        confidence:    r.confidence,
        tokens:        fb?.trim().split(/\s+/).length ?? 0,
        emotions:      emotionsMap,
        source:        'model'          as const,
        emotion:       r.emotion,
        emotion_score: r.emotion_score,
        valence:       r.valence,
        valence_score: r.valence_score,
        all_emotions:  r.all_emotions ?? [],
        language:      lang,
      } satisfies ModelSentimentResult
    })
  } catch {
    return lexiconFallback()
  }
}
