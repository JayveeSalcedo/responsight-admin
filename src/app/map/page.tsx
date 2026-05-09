import { redirect } from 'next/navigation'

// ─── Type definitions ─────────────────────────────────────────────────────────

export interface MapIncident {
  id:              string
  incident_type:   string
  title:           string
  location:        string
  status:          string
  severity:        string
  created_at:      string
  latitude:        number | null
  longitude:       number | null
  responder_name:  string | null
}

export interface ResponderLocation {
  responder_id:     string
  first_name:       string
  last_name:        string
  latitude:         number
  longitude:        number
  heading:          number | null
  speed:            number | null
  updated_at:       string
  responder_status: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MapPage() {
  // Map is accessed from the Incidents tab to keep routing simple.
  redirect('/incidents')
}
