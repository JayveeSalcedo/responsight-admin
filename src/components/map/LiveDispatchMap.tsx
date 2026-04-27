'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, TileLayer } from 'leaflet'
import type { ResponderLocation, MapIncident } from '@/app/map/page'
import { TILE_LAYERS, MAP_STYLE_ORDER, type MapStyle } from './tileLayers'
import 'leaflet/dist/leaflet.css'

interface Props {
  responders:          ResponderLocation[]
  incidents:           MapIncident[]
  selectedResponderId: string | null
  selectedIncidentId:  string | null
  onSelectResponder:   (id: string) => void
  onSelectIncident:    (id: string) => void
}

const severityColor: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  medium: '#eab308',
  low:    '#22c55e',
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
  return typeEmoji[type?.toLowerCase()] ?? '📍'
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

function responderIconHtml(r: ResponderLocation, isSelected: boolean) {
  const isOnScene = r.responder_status === 'on_scene'
  const color     = isOnScene ? '#f97316' : '#22c55e'
  const size      = isSelected ? 48 : 38

  return `
    <div style="position:relative;width:${size}px;height:${size}px;filter:drop-shadow(0 3px 8px rgba(0,0,0,0.6));">
      ${(r.speed ?? 0) > 1 ? `
      <div style="
        position:absolute;top:-8px;left:50%;transform:translateX(-50%) rotate(${r.heading ?? 0}deg);
        width:0;height:0;
        border-left:5px solid transparent;border-right:5px solid transparent;
        border-bottom:10px solid ${color};opacity:0.8;
      "></div>` : ''}
      <div style="
        position:absolute;inset:0;
        background:${color};
        border:${isSelected?'3px solid #fff':'2px solid rgba(255,255,255,0.4)'};
        border-radius:50%;
        box-shadow:0 0 0 ${isSelected?'4px':'2px'} ${color}55;
        display:flex;align-items:center;justify-content:center;
        font-size:${isSelected?20:16}px;
      ">🧑‍🚒</div>
      ${isOnScene ? `<div style="
        position:absolute;inset:-6px;
        border:2px solid ${color};border-radius:50%;
        animation:ping 1.5s ease-out infinite;opacity:0;
      "></div>` : ''}
      <div style="
        position:absolute;bottom:-10px;left:50%;transform:translateX(-50%);
        background:#13161e;border:1px solid ${color}66;
        color:${color};font-size:9px;font-weight:700;
        padding:1px 5px;border-radius:4px;white-space:nowrap;
      ">${r.first_name[0]}${r.last_name[0]}</div>
    </div>
  `
}

function incidentIconHtml(inc: MapIncident, isSelected: boolean) {
  const color = severityColor[inc.severity] ?? '#6b7280'
  const emoji = getEmoji(inc.incident_type)
  const sz    = isSelected ? 44 : 36

  return `
    <div style="display:flex;flex-direction:column;align-items:center;width:${sz}px;">
      <div style="position:relative;width:${sz}px;height:${sz}px;flex-shrink:0;">
        <div style="
          position:absolute;inset:0;
          background:${color};
          border:${isSelected ? '3px' : '2px'} solid #fff;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          box-shadow:0 3px 10px rgba(0,0,0,0.55),0 0 0 ${isSelected ? '3px' : '0px'} ${color}66;
        "></div>
        <div style="
          position:absolute;inset:0;
          display:flex;align-items:center;justify-content:center;
          padding-bottom:3px;
          font-size:${isSelected ? 20 : 15}px;line-height:1;
        ">${emoji}</div>
      </div>
      <div style="
        width:0;height:0;
        border-left:5px solid transparent;
        border-right:5px solid transparent;
        border-top:6px solid ${color};
      "></div>
      <div style="
        background:${color};color:#fff;
        font-size:9px;font-weight:700;line-height:1;
        padding:2px 5px;border-radius:3px;
        white-space:nowrap;max-width:72px;
        overflow:hidden;text-overflow:ellipsis;
        box-shadow:0 1px 4px rgba(0,0,0,0.4);
      ">${inc.incident_type}</div>
    </div>
  `
}

export default function LiveDispatchMap({
  responders, incidents, selectedResponderId, selectedIncidentId,
  onSelectResponder, onSelectIncident,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<LeafletMap | null>(null)
  const tileRef      = useRef<TileLayer | null>(null)
  const rMarkersRef  = useRef<Map<string, any>>(new Map())
  const iMarkersRef  = useRef<Map<string, any>>(new Map())

  const [mapStyle,   setMapStyle]   = useState<MapStyle>('dark')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mapReady,   setMapReady]   = useState(false)

  // Urdaneta City, Pangasinan — tight bounding box
  const URDANETA_CENTER: [number, number] = [15.9762, 120.5711]
  const URDANETA_ZOOM   = 14
  const URDANETA_BOUNDS: [[number,number],[number,number]] = [
    [15.92, 120.51],  // SW corner
    [16.03, 120.63],  // NE corner
  ]

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    import('leaflet').then(L => {
      if (mapRef.current) return

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
      })

      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        subdomains:  cfg.subdomains ?? 'abc',
        maxZoom:     cfg.maxZoom,
      }).addTo(map)

      mapRef.current = map
      // invalidateSize fixes the black-box / tile-gap bug that happens when
      // the container is measured before CSS finishes painting.
      setTimeout(() => map.invalidateSize(), 150)
      // Signal that the map instance is ready so marker effects can run
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
      if (tileRef.current) map.removeLayer(tileRef.current)

      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        subdomains:  cfg.subdomains ?? 'abc',
        maxZoom:     cfg.maxZoom,
      }).addTo(map)

      // Keep markers on top
      rMarkersRef.current.forEach(m => m.bringToFront?.())
      iMarkersRef.current.forEach(m => m.bringToFront?.())
    })
  }, [mapStyle])

  // ── Sync responder markers ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return

    import('leaflet').then(L => {
      const map      = mapRef.current!
      const existing = rMarkersRef.current
      const nextIds  = new Set(responders.map(r => r.responder_id))

      existing.forEach((marker, id) => {
        if (!nextIds.has(id)) { marker.remove(); existing.delete(id) }
      })

      responders.forEach(r => {
        const isSelected = r.responder_id === selectedResponderId
        const color      = r.responder_status === 'on_scene' ? '#f97316' : '#22c55e'
        const isDark     = mapStyle === 'dark'
        const bg         = isDark ? '#13161e' : '#ffffff'
        const text       = isDark ? '#f0f2f8' : '#1a1a2e'
        const subtext    = isDark ? '#8b93a8' : '#6b7280'
        const brd        = isDark ? '#1e2330' : '#e5e7eb'

        const icon = L.divIcon({
          className: 'leaflet-div-icon-clean',
          iconSize:  [isSelected ? 48 : 38, isSelected ? 62 : 52],
          iconAnchor:[isSelected ? 24 : 19, isSelected ? 42 : 34],
          html: responderIconHtml(r, isSelected),
        })

        const popupHtml = `
          <div style="font-family:sans-serif;min-width:180px;background:${bg};color:${text};border-radius:10px;overflow:hidden;border:1px solid ${brd};">
            <div style="padding:10px 12px;border-bottom:1px solid ${brd};">
              <div style="font-size:13px;font-weight:700;">${r.first_name} ${r.last_name}</div>
              <div style="font-size:10px;margin-top:3px;color:${color};font-weight:600;text-transform:uppercase;">
                ${r.responder_status === 'on_scene' ? '🟠 On Scene' : '🟢 Online'}
              </div>
            </div>
            <div style="padding:8px 12px;font-size:11px;color:${subtext};line-height:1.8;">
              ${r.speed != null ? `<div>🏃 ${Math.round(r.speed)} km/h</div>` : ''}
              <div>🕒 Updated ${timeAgo(r.updated_at)}</div>
            </div>
          </div>
        `

        if (existing.has(r.responder_id)) {
          const marker = existing.get(r.responder_id)!
          marker.setLatLng([r.latitude, r.longitude])
          marker.setIcon(icon)
          marker.getPopup()?.setContent(popupHtml)
        } else {
          const popup = L.popup({
            closeButton: false, className: 'dispatch-popup',
            offset: [0, -8], maxWidth: 220,
          }).setContent(popupHtml)

          const marker = L.marker([r.latitude, r.longitude], { icon, zIndexOffset: 1000 })
            .addTo(map).bindPopup(popup)

          marker.on('click',     () => { onSelectResponder(r.responder_id); marker.openPopup() })
          marker.on('mouseover', () => marker.openPopup())
          marker.on('mouseout',  () => { if (r.responder_id !== selectedResponderId) marker.closePopup() })

          existing.set(r.responder_id, marker)
        }

        if (isSelected) existing.get(r.responder_id)?.openPopup()
      })
    })
  }, [responders, selectedResponderId, mapStyle, mapReady])

  // ── Sync incident markers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapReady) return

    import('leaflet').then(L => {
      const map      = mapRef.current!
      const existing = iMarkersRef.current
      const nextIds  = new Set(incidents.map(i => i.id))

      existing.forEach((marker, id) => {
        if (!nextIds.has(id)) { marker.remove(); existing.delete(id) }
      })

      incidents.filter(inc => inc.latitude != null && inc.longitude != null).forEach(inc => {
        const isSelected = inc.id === selectedIncidentId
        const color      = severityColor[inc.severity] ?? '#6b7280'
        const isDark     = mapStyle === 'dark'
        const bg         = isDark ? '#13161e' : '#ffffff'
        const text       = isDark ? '#f0f2f8' : '#1a1a2e'
        const subtext    = isDark ? '#8b93a8' : '#6b7280'
        const brd        = isDark ? '#1e2330' : '#e5e7eb'

        const icon = L.divIcon({
          className: 'leaflet-div-icon-clean',
          iconSize:  [isSelected ? 44 : 36, isSelected ? 44 + 22 : 36 + 22],
          iconAnchor:[(isSelected ? 44 : 36) / 2, isSelected ? 44 + 22 : 36 + 22],
          html: incidentIconHtml(inc, isSelected),
        })

        const popupHtml = `
          <div style="font-family:sans-serif;min-width:200px;background:${bg};color:${text};border-radius:10px;overflow:hidden;border:1px solid ${brd};">
            <div style="background:${color}22;border-bottom:1px solid ${color}44;padding:10px 12px;">
              <div style="display:flex;gap:6px;margin-bottom:4px;">
                <span style="font-size:11px;color:${color};font-weight:700;text-transform:uppercase;background:${color}22;border:1px solid ${color}44;padding:2px 6px;border-radius:4px;">${inc.severity}</span>
                <span style="font-size:11px;color:${subtext};font-weight:600;text-transform:uppercase;background:${isDark?'#1e2330':'#f3f4f6'};border:1px solid ${brd};padding:2px 6px;border-radius:4px;">${inc.status.replace('_',' ')}</span>
              </div>
              <div style="font-size:13px;font-weight:700;line-height:1.3;">${inc.title}</div>
            </div>
            <div style="padding:8px 12px;font-size:11px;color:${subtext};line-height:1.8;">
              <div>📍 ${inc.location}</div>
              <div>🕒 ${timeAgo(inc.created_at)}</div>
              ${inc.responder_name ? `<div>🚨 ${inc.responder_name}</div>` : `<div style="color:${subtext}">Unassigned</div>`}
            </div>
          </div>
        `

        if (existing.has(inc.id)) {
          const marker = existing.get(inc.id)!
          marker.setIcon(icon)
          marker.getPopup()?.setContent(popupHtml)
        } else {
          const popup = L.popup({
            closeButton: false, className: 'dispatch-popup',
            offset: [0, -8], maxWidth: 240,
          }).setContent(popupHtml)

          const marker = L.marker([inc.latitude as number, inc.longitude as number], { icon })
            .addTo(map).bindPopup(popup)

          marker.on('click',     () => { onSelectIncident(inc.id); marker.openPopup() })
          marker.on('mouseover', () => marker.openPopup())
          marker.on('mouseout',  () => { if (inc.id !== selectedIncidentId) marker.closePopup() })

          existing.set(inc.id, marker)
        }

        if (isSelected) existing.get(inc.id)?.openPopup()
      })
    })
  }, [incidents, selectedIncidentId, mapStyle, mapReady])

  // ── Pan to selected ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedResponderId || !mapRef.current || !mapReady) return
    const r = responders.find(r => r.responder_id === selectedResponderId)
    if (r) mapRef.current.panTo([r.latitude, r.longitude], { animate: true })
  }, [selectedResponderId, mapReady])

  useEffect(() => {
    if (!selectedIncidentId || !mapRef.current || !mapReady) return
    const i = incidents.find(i => i.id === selectedIncidentId)
    if (i && i.latitude != null && i.longitude != null) mapRef.current.panTo([i.latitude, i.longitude], { animate: true })
  }, [selectedIncidentId, mapReady])

  return (
    <>
      <style>{`
        .leaflet-div-icon-clean {
          background: transparent !important;
          border: none !important;
        }
        .dispatch-popup .leaflet-popup-content-wrapper {
          background:transparent!important;border:none!important;
          padding:0!important;box-shadow:0 8px 32px rgba(0,0,0,0.6)!important;
          border-radius:10px!important;
        }
        .dispatch-popup .leaflet-popup-content { margin:0!important; }
        .dispatch-popup .leaflet-popup-tip-container { display:none!important; }
        .leaflet-control-zoom a {
          background:#13161e!important;color:#f0f2f8!important;border-color:#1e2330!important;
        }
        .leaflet-control-zoom a:hover { background:#252a38!important; }
        .leaflet-control-attribution {
          background:rgba(13,15,20,0.7)!important;color:#4d566b!important;font-size:9px!important;
        }
        .leaflet-control-attribution a { color:#4d566b!important; }
        @keyframes ping {
          0%   { transform:scale(0.8);opacity:0.8; }
          100% { transform:scale(2);opacity:0; }
        }
      `}</style>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── Floating map style picker ───────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: '80px', right: '12px',
        zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
      }}>
        {pickerOpen && MAP_STYLE_ORDER.map(style => {
          const cfg      = TILE_LAYERS[style]
          const isActive = style === mapStyle
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
