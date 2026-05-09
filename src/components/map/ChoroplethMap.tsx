'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import type { Map as LeafletMap, TileLayer } from 'leaflet'
import { TILE_LAYERS, MAP_STYLE_ORDER, type MapStyle } from './tileLayers'
import 'leaflet/dist/leaflet.css'

// ─── Dataset Choropleth ───────────────────────────────────────────────────────
// Accepts barangay name → count directly from uploaded CSV data.
// No lat/lng point-in-polygon needed — matched by ADM4_EN property name.

interface DatasetChoroplethProps {
  /** barangay display name → total count (Bypass excluded before passing in) */
  counts: Record<string, number>
  label?: string // e.g. "Accidents" — shown in legend title
}

const COLOR_SCALE = [
  '#fef0d9', // 0
  '#fdd49e', // 1–25
  '#fdbb84', // 26–50
  '#fc8d59', // 51–100
  '#e34a33', // 101–200
  '#b30000', // 200+
]

function getColor(count: number) {
  if (count === 0) return COLOR_SCALE[0]
  if (count <= 25) return COLOR_SCALE[1]
  if (count <= 50) return COLOR_SCALE[2]
  if (count <= 100) return COLOR_SCALE[3]
  if (count <= 200) return COLOR_SCALE[4]
  return COLOR_SCALE[5]
}

// Fuzzy match: try exact, then case-insensitive, then substring
function matchBarangay(adm4Name: string, counts: Record<string, number>): number {
  // exact
  if (counts[adm4Name] !== undefined) return counts[adm4Name]
  // case-insensitive
  const lower = adm4Name.toLowerCase()
  for (const [k, v] of Object.entries(counts)) {
    if (k.toLowerCase() === lower) return v
  }
  // substring both ways
  for (const [k, v] of Object.entries(counts)) {
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return v
  }
  return 0
}

export function DatasetChoroplethMap({ counts, label = 'Incidents' }: DatasetChoroplethProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const geojsonLayerRef = useRef<any>(null)
  const tileRef = useRef<TileLayer | null>(null)
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [geoData, setGeoData] = useState<any>(null)
  const [mapReady, setMapReady] = useState(false)

  // Fetch GeoJSON
  useEffect(() => {
    fetch('/urdaneta-barangays.json')
      .then(r => r.json())
      .then(d => setGeoData(d))
      .catch(console.error)
  }, [])

  // Map initialization
  useEffect(() => {
    if (!containerRef.current) return
    import('leaflet').then(L => {
      if (mapRef.current) return
      const map = L.map(containerRef.current!, {
        center: [15.9762, 120.5711], zoom: 13, minZoom: 12, maxZoom: 18, zoomControl: true,
      })
      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains ?? 'abc', maxZoom: cfg.maxZoom }).addTo(map)
      mapRef.current = map
      // invalidateSize fixes the black-box / tile-gap bug when the container
      // is measured before CSS finishes painting.
      setTimeout(() => map.invalidateSize(), 150)
      setMapReady(true)
    })
    return () => { mapRef.current?.remove(); mapRef.current = null; tileRef.current = null; setMapReady(false) }
  }, [])

  // Tile layer change
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      const map = mapRef.current!
      if (tileRef.current) map.removeLayer(tileRef.current)
      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains ?? 'abc', maxZoom: cfg.maxZoom }).addTo(map)
      if (geojsonLayerRef.current) geojsonLayerRef.current.bringToFront()
    })
  }, [mapStyle])

  // Render choropleth
  useEffect(() => {
    if (!mapRef.current || !mapReady || !geoData) return
    import('leaflet').then(L => {
      const map = mapRef.current!
      if (geojsonLayerRef.current) map.removeLayer(geojsonLayerRef.current)

      function style(feature: any) {
        const count = matchBarangay(feature.properties.ADM4_EN, counts)
        return { fillColor: getColor(count), weight: 1.5, opacity: 1, color: '#ffffff', dashArray: '3', fillOpacity: 0.75 }
      }

      function onEachFeature(feature: any, layer: any) {
        const brgyName = feature.properties.ADM4_EN
        const count = matchBarangay(brgyName, counts)
        const isDark = mapStyle === 'dark'
        const bg = isDark ? '#13161e' : '#ffffff'
        const text = isDark ? '#f0f2f8' : '#1a1a2e'
        const subtext = isDark ? '#8b93a8' : '#6b7280'
        const brd = isDark ? '#1e2330' : '#e5e7eb'

        const tooltipHtml = `
          <div style="font-family:sans-serif;min-width:140px;background:${bg};color:${text};border-radius:8px;overflow:hidden;border:1px solid ${brd};">
            <div style="padding:8px 10px;border-bottom:1px solid ${brd};font-weight:bold;font-size:13px;">${brgyName}</div>
            <div style="padding:8px 10px;font-size:12px;color:${subtext};">${count.toLocaleString()} ${label.toLowerCase()}</div>
          </div>`

        layer.bindTooltip(tooltipHtml, { sticky: true, className: 'choropleth-tooltip', direction: 'auto' })
        layer.on({
          mouseover: (e: any) => {
            const l = e.target
            l.setStyle({ weight: 3, color: '#6366f1', dashArray: '', fillOpacity: 0.9 })
            if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) l.bringToFront()
          },
          mouseout: (e: any) => { geojsonLayerRef.current.resetStyle(e.target) },
        })
      }

      geojsonLayerRef.current = L.geoJSON(geoData, { style, onEachFeature }).addTo(map)
    })
  }, [geoData, counts, mapStyle, mapReady])

  const LEGEND_ENTRIES = [
    { label: '0', color: COLOR_SCALE[0] },
    { label: '1–25', color: COLOR_SCALE[1] },
    { label: '26–50', color: COLOR_SCALE[2] },
    { label: '51–100', color: COLOR_SCALE[3] },
    { label: '101–200', color: COLOR_SCALE[4] },
    { label: '200+', color: COLOR_SCALE[5] },
  ]

  return (
    <>
      <style>{`
        .choropleth-tooltip { background:transparent!important;border:none!important;box-shadow:0 4px 16px rgba(0,0,0,.5)!important;padding:0!important;border-radius:8px!important; }
        .choropleth-tooltip::before { display:none!important; }
        .leaflet-control-zoom a { background:#13161e!important;color:#f0f2f8!important;border-color:#1e2330!important; }
        .leaflet-control-zoom a:hover { background:#252a38!important; }
        .leaflet-control-attribution { background:rgba(13,15,20,.7)!important;color:#4d566b!important;font-size:9px!important; }
        .leaflet-control-attribution a { color:#4d566b!important; }
      `}</style>

      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Map style picker */}
      <div style={{ position: 'absolute', bottom: '80px', right: '12px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
        {pickerOpen && MAP_STYLE_ORDER.map(s => {
          const cfg = TILE_LAYERS[s]; const isActive = s === mapStyle
          return (
            <button key={s} onClick={() => { setMapStyle(s); setPickerOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', borderRadius: '10px', border: `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.12)'}`, background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', color: isActive ? '#a5b4fc' : '#d1d5db', fontSize: '12px', fontWeight: isActive ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
              <span style={{ fontSize: '15px' }}>{cfg.icon}</span>{cfg.label}{isActive && <span style={{ fontSize: '10px' }}>✓</span>}
            </button>
          )
        })}
        <button onClick={() => setPickerOpen(p => !p)}
          style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: pickerOpen ? 'rgba(99,102,241,0.3)' : 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', color: '#f0f2f8', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          {TILE_LAYERS[mapStyle].icon}
        </button>
      </div>

      {/* Legend */}
      <div style={{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 1000, background: 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '10px 12px', color: '#f0f2f8', fontSize: '11px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '12px' }}>{label}</div>
        {LEGEND_ENTRIES.map(e => (
          <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <div style={{ width: '12px', height: '12px', background: e.color, border: '1px solid rgba(255,255,255,0.3)', borderRadius: '2px' }} />
            <span>{e.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Original ChoroplethMap (InApp tab — unchanged) ───────────────────────────

import type { MapIncident } from '@/app/map/page'
import * as turf from '@turf/helpers'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'

interface Props { incidents: MapIncident[] }

const INAPP_COLOR_SCALE = [
  '#fef0d9', '#fdd49e', '#fdbb84', '#fc8d59', '#e34a33', '#b30000',
]

function getInAppColor(count: number) {
  if (count === 0) return INAPP_COLOR_SCALE[0]
  if (count <= 2) return INAPP_COLOR_SCALE[1]
  if (count <= 4) return INAPP_COLOR_SCALE[2]
  if (count <= 6) return INAPP_COLOR_SCALE[3]
  if (count <= 9) return INAPP_COLOR_SCALE[4]
  return INAPP_COLOR_SCALE[5]
}

export default function ChoroplethMap({ incidents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const geojsonLayerRef = useRef<any>(null)
  const tileRef = useRef<TileLayer | null>(null)
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [geoData, setGeoData] = useState<any>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    fetch('/urdaneta-barangays.json').then(res => res.json()).then(data => setGeoData(data)).catch(console.error)
  }, [])

  const aggregatedData = useMemo(() => {
    if (!geoData || !incidents) return null
    // Count incidents by barangay using point-in-polygon matching.
    const counts = new Map<string, { count: number; incidents: MapIncident[] }>()
    geoData.features.forEach((f: any) => { counts.set(f.properties.ADM4_EN, { count: 0, incidents: [] }) })
    incidents.forEach(inc => {
      if (inc.latitude && inc.longitude) {
        const pt = turf.point([inc.longitude, inc.latitude])
        for (const f of geoData.features) {
          if (booleanPointInPolygon(pt, f)) {
            const brgyName = f.properties.ADM4_EN
            const current = counts.get(brgyName)
            if (current) { current.count += 1; current.incidents.push(inc) }
            break
          }
        }
      }
    })
    return counts
  }, [geoData, incidents])

  useEffect(() => {
    if (!containerRef.current) return
    import('leaflet').then(L => {
      if (mapRef.current) return
      const map = L.map(containerRef.current!, { center: [15.9762, 120.5711], zoom: 13, minZoom: 12, maxZoom: 18, zoomControl: true })
      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains ?? 'abc', maxZoom: cfg.maxZoom }).addTo(map)
      mapRef.current = map;
      // invalidateSize fixes the black-box / tile-gap bug when the container
      // is measured before CSS finishes painting.
      setTimeout(() => map.invalidateSize(), 150)
      setMapReady(true)
    })
    return () => { mapRef.current?.remove(); mapRef.current = null; tileRef.current = null; setMapReady(false) }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      const map = mapRef.current!
      if (tileRef.current) map.removeLayer(tileRef.current)
      const cfg = TILE_LAYERS[mapStyle]
      tileRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, subdomains: cfg.subdomains ?? 'abc', maxZoom: cfg.maxZoom }).addTo(map)
      if (geojsonLayerRef.current) geojsonLayerRef.current.bringToFront()
    })
  }, [mapStyle])

  useEffect(() => {
    if (!mapRef.current || !mapReady || !geoData || !aggregatedData) return
    import('leaflet').then(L => {
      const map = mapRef.current!
      if (geojsonLayerRef.current) map.removeLayer(geojsonLayerRef.current)
      function style(feature: any) {
        const brgyName = feature.properties.ADM4_EN; const agg = aggregatedData!.get(brgyName); const count = agg?.count || 0
        return { fillColor: getInAppColor(count), weight: 1.5, opacity: 1, color: '#ffffff', dashArray: '3', fillOpacity: 0.75 }
      }
      function onEachFeature(feature: any, layer: any) {
        const brgyName = feature.properties.ADM4_EN; const agg = aggregatedData!.get(brgyName); const count = agg?.count || 0
        const isDark = mapStyle === 'dark'; const bg = isDark ? '#13161e' : '#ffffff'; const text = isDark ? '#f0f2f8' : '#1a1a2e'
        const subtext = isDark ? '#8b93a8' : '#6b7280'; const brd = isDark ? '#1e2330' : '#e5e7eb'
        let incidentList = ''
        if (count > 0 && agg) {
          incidentList = agg.incidents.map(i => {
            const color = i.severity === 'urgent' ? '#ef4444' : i.severity === 'high' ? '#f97316' : i.severity === 'medium' ? '#eab308' : '#22c55e'
            return `<div style="margin-top:4px;padding:4px 6px;border-radius:4px;background:${color}22;border:1px solid ${color}44;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${i.title}</div>`
          }).join('')
        }
        const tooltipHtml = `<div style="font-family:sans-serif;min-width:140px;background:${bg};color:${text};border-radius:8px;overflow:hidden;border:1px solid ${brd};"><div style="padding:8px 10px;border-bottom:1px solid ${brd};font-weight:bold;font-size:13px;">${brgyName}</div><div style="padding:8px 10px;font-size:12px;"><div style="margin-bottom:4px;color:${subtext};font-weight:600;">${count} active incident${count !== 1 ? 's' : ''}</div>${incidentList}</div></div>`
        layer.bindTooltip(tooltipHtml, { sticky: true, className: 'choropleth-tooltip', direction: 'auto' })
        layer.on({
          mouseover: (e: any) => { const l = e.target; l.setStyle({ weight: 3, color: '#6366f1', dashArray: '', fillOpacity: 0.9 }); if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) l.bringToFront() },
          mouseout: (e: any) => { geojsonLayerRef.current.resetStyle(e.target) },
        })
      }
      geojsonLayerRef.current = L.geoJSON(geoData, { style, onEachFeature }).addTo(map)
    })
  }, [geoData, aggregatedData, mapStyle, mapReady])

  return (
    <>
      <style>{`
        .choropleth-tooltip { background:transparent!important;border:none!important;box-shadow:0 4px 16px rgba(0,0,0,.5)!important;padding:0!important;border-radius:8px!important; }
        .choropleth-tooltip::before { display:none!important; }
        .leaflet-control-zoom a { background:#13161e!important;color:#f0f2f8!important;border-color:#1e2330!important; }
        .leaflet-control-zoom a:hover { background:#252a38!important; }
        .leaflet-control-attribution { background:rgba(13,15,20,.7)!important;color:#4d566b!important;font-size:9px!important; }
        .leaflet-control-attribution a { color:#4d566b!important; }
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: '80px', right: '12px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
        {pickerOpen && MAP_STYLE_ORDER.map(style => {
          const cfg = TILE_LAYERS[style]; const isActive = style === mapStyle
          return (
            <button key={style} onClick={() => { setMapStyle(style); setPickerOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', borderRadius: '10px', border: `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.12)'}`, background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', color: isActive ? '#a5b4fc' : '#d1d5db', fontSize: '12px', fontWeight: isActive ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
              <span style={{ fontSize: '15px' }}>{cfg.icon}</span>{cfg.label}{isActive && <span style={{ marginLeft: '2px', fontSize: '10px' }}>✓</span>}
            </button>
          )
        })}
        <button onClick={() => setPickerOpen(p => !p)}
          style={{ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: pickerOpen ? 'rgba(99,102,241,0.3)' : 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', color: '#f0f2f8', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', transition: 'all 0.15s' }}>
          {TILE_LAYERS[mapStyle].icon}
        </button>
      </div>
      <div style={{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 1000, background: 'rgba(13,15,20,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '10px 12px', color: '#f0f2f8', fontSize: '11px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '12px' }}>Incident Count</div>
        {[{ label: '0', color: INAPP_COLOR_SCALE[0] }, { label: '1-2', color: INAPP_COLOR_SCALE[1] }, { label: '3-4', color: INAPP_COLOR_SCALE[2] }, { label: '5-6', color: INAPP_COLOR_SCALE[3] }, { label: '7-9', color: INAPP_COLOR_SCALE[4] }, { label: '10+', color: INAPP_COLOR_SCALE[5] }].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <div style={{ width: '12px', height: '12px', background: item.color, border: '1px solid rgba(255,255,255,0.3)', borderRadius: '2px' }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}
