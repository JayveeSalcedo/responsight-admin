export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low'
export type IncidentStatus   = 'pending' | 'in_progress' | 'resolved' | 'closed'
export type IncidentType     = 'fire' | 'flood' | 'medical' | 'crime' | 'accident' | 'other'

export type ResponderStatus = 'available' | 'on_duty' | 'off_duty'
export type AgencyType      = 'CDRRMO' | 'BFP' | 'PNP' | 'NDRRMC' | 'other'

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'joy' | 'sadness' | 'anger' | 'fear' | 'disgust' | 'surprise'
export type DetectedLanguage = 'english' | 'tagalog' | 'taglish'

export interface ModelSentimentResult {
  label:         SentimentLabel
  score:         number
  confidence:    number
  tokens:        number
  emotions:      Record<string, number>
  source:        'model' | 'lexicon'
  emotion:       string
  emotion_score: number
  valence:       string
  valence_score: number
  all_emotions:  { label: string; score: number }[]
  language:      DetectedLanguage
}

export interface Incident {
  id:          string
  created_at:  string
  updated_at:  string
  type:        IncidentType
  severity:    IncidentSeverity
  status:      IncidentStatus
  title:       string
  description: string
  location:    string
  latitude:    number | null
  longitude:   number | null
  reported_by: string
  assigned_to: string | null
  agency_id:   string
  sentiment:   SentimentLabel | null
}

export interface Responder {
  id:          string
  created_at:  string
  full_name:   string
  email:       string
  phone:       string | null
  agency_id:   string
  status:      ResponderStatus
  badge_number: string | null
  avatar_url:  string | null
}

export interface Agency {
  id:         string
  name:       string
  type:       AgencyType
  region:     string
  created_at: string
}

export interface Advisory {
  id:         string
  created_at: string
  title:      string
  content:    string
  severity:   IncidentSeverity
  agency_id:  string
  is_active:  boolean
  expires_at: string | null
}

export interface Feedback {
  id:          string
  created_at:  string
  incident_id: string | null
  agency_id:   string
  user_id:     string
  rating:      number
  comment:     string | null
  sentiment:   SentimentLabel | null
}

export interface SentimentData {
  date:     string
  positive: number
  neutral:  number
  negative: number
  joy:      number
  sadness:  number
  anger:    number
  fear:     number
  disgust:  number
  surprise: number
}

export interface DashboardStats {
  active_incidents:     number
  resolved_today:       number
  available_responders: number
  avg_response_minutes: number
  sentiment_score:      number
}
