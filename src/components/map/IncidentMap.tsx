'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, TileLayer } from 'leaflet'
import { TILE_LAYERS, MAP_STYLE_ORDER, type MapStyle } from './tileLayers'

// Load Leaflet CSS only when this map component is actually used,
// not on every page of the app.
import 'leaflet/dist/leaflet.css'

export interface MapReport {
  id:            string
  incident_type: string
  title:         string
  location:      string
  status:        string
  severity:      string
  created_at:    string
  latitude:      number
  longitude:     number
  agency_name:   string | null
  agency_type:   string | null
  reporter_name:  string | null
  responder_name: string | null
}

interface IncidentMapProps {
  reports:         MapReport[]
  onSelectReport?: (report: MapReport) => void
  selectedId?:     string | null
}

const severityColor: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  medium: '#eab308',
  low:    '#22c55e',
}

const statusBorder: Record<string, string> = {
  pending:    '#eab308',
  verified:   '#3b82f6',
  responding: '#8b5cf6',
  resolved:   '#22c55e',
  rejected:   '#6b7280',
}

const typeEmoji: Record<string, string> = {
  fire:                '🔥',
  flood:               '🌊',
  medical:             '🏥',
  'medical emergency': '🏥',
  accident:            '🚗',
  crime:               '⚠️',
  'natural disaster':  '🌪️',
  other:               '📍',
}

function getEmoji(type: string) {
  return typeEmoji[type.toLowerCase()] ?? '📍'
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function IncidentMap({ reports, onSelectReport, selectedId }: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<LeafletMap | null>(null)
  const markersRef   = useRef<any[]>([])
  const tileRef      = useRef<TileLayer | null>(null)

  const [mapStyle,     setMapStyle]     = useState<MapStyle>('dark')
  const [pickerOpen,   setPickerOpen]   = useState(false)
  const [mapReady,     setMapReady]     = useState(false)

  // Urdaneta City, Pangasinan
  const URDANETA_CENTER: [number, number] = [15.9762, 120.5711]
  const URDANETA_ZOOM   = 14
  const URDANETA_BOUNDS: [[number,number],[number,number]] = [
    [15.92, 120.51],
    [16.03, 120.63],
  ]

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return

      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(containerRef.current!, {
        center:   URDANETA_CENTER,
        zoom:     URDANETA_ZOOM,
        minZoom:  13,
        maxZoom:  18,
        maxBounds: URDANETA_BOUNDS,
        maxBoundsViscosity: 0.85,
        zoomControl: true,
        attributionControl: true,
      })

      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        subdomains:  cfg.subdomains ?? 'abc',
        maxZoom:     cfg.maxZoom,
      }).addTo(map)

      mapRef.current = map
      setMapReady(true)
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
      tileRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Swap tile layer when style changes ────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return

    import('leaflet').then(L => {
      const map = mapRef.current!
      if (tileRef.current) {
        map.removeLayer(tileRef.current)
      }
      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        subdomains:  cfg.subdomains ?? 'abc',
        maxZoom:     cfg.maxZoom,
      }).addTo(map)

      // Bring markers back to front
      markersRef.current.forEach(m => m.bringToFront?.())
    })
  }, [mapStyle])

  // ── Sync markers whenever reports change ──────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return

    import('leaflet').then(L => {
      const map = mapRef.current!

      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      // Filter out reports without coordinates to avoid Leaflet errors.
      const validReports = reports.filter(r => r.latitude && r.longitude)

      validReports.forEach(report => {
        const color      = severityColor[report.severity] ?? '#6b7280'
        const border     = statusBorder[report.status]    ?? '#ffffff'
        const emoji      = getEmoji(report.incident_type)
        const isSelected = report.id === selectedId

        const sz = isSelected ? 44 : 36
        // Use a custom div icon for emoji + severity styling.
        const icon = L.divIcon({
          className: 'leaflet-div-icon-clean',
          // total height = circle + tail(6) + label(~16)
          iconSize:  [sz, sz + 22],
          iconAnchor:[sz / 2, sz + 22],
          html: `
            <div style="display:flex;flex-direction:column;align-items:center;width:${sz}px;">
              <div style="
                position:relative;
                width:${sz}px;height:${sz}px;
                flex-shrink:0;
              ">
                <div style="
                  position:absolute;inset:0;
                  background:${color};
                  border:${isSelected ? '3px' : '2.5px'} solid #fff;
                  border-radius:50% 50% 50% 0;
                  transform:rotate(-45deg);
                  box-shadow:0 3px 10px rgba(0,0,0,0.55),0 0 0 ${isSelected?'3px':'0px'} ${color}66;
                "></div>
                <div style="
                  position:absolute;inset:0;
                  display:flex;align-items:center;justify-content:center;
                  padding-bottom:3px;
                  font-size:${isSelected?18:14}px;line-height:1;
                ">${emoji}</div>
              </div>
              <div style="
                width:0;height:0;
                border-left:5px solid transparent;
                border-right:5px solid transparent;
                border-top:6px solid ${color};
              "></div>
              <div style="
                margin-top:1px;
                background:${color};
                color:#fff;
                font-size:9px;
                font-weight:700;
                line-height:1;
                padding:2px 5px;
                border-radius:3px;
                white-space:nowrap;
                max-width:72px;
                overflow:hidden;
                text-overflow:ellipsis;
                box-shadow:0 1px 4px rgba(0,0,0,0.4);
                letter-spacing:0.2px;
              ">${report.incident_type}</div>
            </div>
          `,
        })

        const isDark  = mapStyle === 'dark'
        const bg      = isDark ? '#13161e' : '#ffffff'
        const text    = isDark ? '#f0f2f8' : '#1a1a2e'
        const subtext = isDark ? '#8b93a8' : '#6b7280'
        const brd     = isDark ? '#1e2330' : '#e5e7eb'

        const popupHtml = `
          <div style="
            font-family:sans-serif;min-width:220px;
            background:${bg};color:${text};
            border-radius:10px;overflow:hidden;
            border:1px solid ${brd};
          ">
            <div style="background:${color}22;border-bottom:1px solid ${color}44;padding:10px 12px;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="font-size:18px">${emoji}</span>
                <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color};background:${color}22;border:1px solid ${color}44;padding:2px 6px;border-radius:4px;">${report.severity}</span>
                <span style="font-size:10px;font-weight:600;text-transform:uppercase;color:${border};background:${border}22;border:1px solid ${border}44;padding:2px 6px;border-radius:4px;margin-left:auto;">${report.status.replace('_',' ')}</span>
              </div>
              <div style="font-size:13px;font-weight:700;line-height:1.3;">${report.title}</div>
            </div>
            <div style="padding:10px 12px;font-size:11px;color:${subtext};line-height:1.8;">
              <div>📍 ${report.location}</div>
              <div>🕒 ${timeAgo(report.created_at)}</div>
              ${report.reporter_name  ? `<div>👤 ${report.reporter_name}</div>`  : ''}
              ${report.responder_name ? `<div>🚨 ${report.responder_name}</div>` : `<div style="color:${subtext}">Unassigned</div>`}
            </div>
          </div>
        `

        const popup = L.popup({
          closeButton: false,
          className:   'incident-popup',
          offset:      [0, -8],
          maxWidth:    280,
        }).setContent(popupHtml)

        const marker = L.marker([report.latitude, report.longitude], { icon })
          .addTo(map)
          .bindPopup(popup)

        marker.on('click',     () => { onSelectReport?.(report); marker.openPopup() })
        marker.on('mouseover', () => marker.openPopup())
        marker.on('mouseout',  () => { if (report.id !== selectedId) marker.closePopup() })

        if (report.id === selectedId) marker.openPopup()

        markersRef.current.push(marker)
      })

      if (validReports.length > 0 && !selectedId) {
        // Auto-fit the map to all visible reports when nothing is selected.
        const bounds = L.latLngBounds(validReports.map(r => [r.latitude, r.longitude] as [number, number]))
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 })
      }
    })
  }, [reports, selectedId, mapStyle, mapReady])

  // ── Pan to selected report ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId || !mapRef.current || !mapReady) return
    const report = reports.find(r => r.id === selectedId)
    if (report?.latitude && report?.longitude) {
      mapRef.current.panTo([report.latitude, report.longitude], { animate: true })
    }
  }, [selectedId, mapReady])

  const isDark = mapStyle === 'dark'

  return (
    <>
      <style>{`
        .leaflet-div-icon-clean {
          background: transparent !important;
          border: none !important;
        }
        .incident-popup .leaflet-popup-content-wrapper {
          background:transparent!important;border:none!important;
          padding:0!important;box-shadow:0 8px 32px rgba(0,0,0,0.6)!important;
          border-radius:10px!important;
        }
        .incident-popup .leaflet-popup-content { margin:0!important; }
        .incident-popup .leaflet-popup-tip-container { display:none!important; }
        .leaflet-control-zoom a {
          background:#13161e!important;color:#f0f2f8!important;border-color:#1e2330!important;
        }
        .leaflet-control-zoom a:hover { background:#252a38!important; }
        .leaflet-control-attribution {
          background:rgba(13,15,20,0.7)!important;color:#4d566b!important;font-size:9px!important;
        }
        .leaflet-control-attribution a { color:#4d566b!important; }
      `}</style>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── Floating map style picker ───────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: '80px', right: '12px',
        zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
      }}>
        {/* Options — shown when open */}
        {pickerOpen && MAP_STYLE_ORDER.map(style => {
          const cfg       = TILE_LAYERS[style]
          const isActive  = style === mapStyle
          return (
            <button
              key={style}
              onClick={() => { setMapStyle(style); setPickerOpen(false) }}
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            '8px',
                padding:        '7px 12px',
                borderRadius:   '10px',
                border:         `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.12)'}`,
                background:     isActive ? 'rgba(99,102,241,0.25)' : 'rgba(13,15,20,0.85)',
                backdropFilter: 'blur(8px)',
                color:          isActive ? '#a5b4fc' : '#d1d5db',
                fontSize:       '12px',
                fontWeight:     isActive ? 700 : 500,
                cursor:         'pointer',
                whiteSpace:     'nowrap',
                transition:     'all 0.15s',
                boxShadow:      '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              <span style={{ fontSize: '15px' }}>{cfg.icon}</span>
              {cfg.label}
              {isActive && <span style={{ marginLeft: '2px', fontSize: '10px' }}>✓</span>}
            </button>
          )
        })}

        {/* Toggle button */}
        <button
          onClick={() => setPickerOpen(p => !p)}
          title="Change map style"
          style={{
            width:          '40px',
            height:         '40px',
            borderRadius:   '10px',
            border:         '1px solid rgba(255,255,255,0.15)',
            background:     pickerOpen ? 'rgba(99,102,241,0.3)' : 'rgba(13,15,20,0.85)',
            backdropFilter: 'blur(8px)',
            color:          '#f0f2f8',
            fontSize:       '18px',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            boxShadow:      '0 4px 16px rgba(0,0,0,0.5)',
            transition:     'all 0.15s',
          }}
        >
          {TILE_LAYERS[mapStyle].icon}
        </button>
      </div>
    </>
  )
}
