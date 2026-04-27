// Shared map tile layers for Responsight Admin
// Used by both IncidentMap and LiveDispatchMap

export type MapStyle = 'dark' | 'street' | 'terrain'

export interface TileLayerConfig {
  label:       string
  icon:        string
  url:         string
  attribution: string
  subdomains?: string
  maxZoom:     number
  tileOptions?: Record<string, any>
}

export const TILE_LAYERS: Record<MapStyle, TileLayerConfig> = {
  dark: {
    label:       'Dark',
    icon:        '🌑',
    url:         'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '©OpenStreetMap ©CartoDB',
    subdomains:  'abcd',
    maxZoom:     19,
  },
  street: {
    label:       'Street',
    icon:        '🗺️',
    url:         'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '©OpenStreetMap ©CartoDB',
    subdomains:  'abcd',
    maxZoom:     19,
  },
  terrain: {
    label:       'Terrain',
    icon:        '⛰️',
    url:         'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '©OpenStreetMap ©OpenTopoMap',
    subdomains:  'abc',
    maxZoom:     17,
  },
}

export const MAP_STYLE_ORDER: MapStyle[] = ['dark', 'street', 'terrain']
