import { tokens } from '@/design/tokens';
import type { AddLayerObject, MapOptions } from 'maplibre-gl';

/**
 * Basemap + overlay layer definitions for the Gebiete map.
 *
 * The admin dashboard runs in a browser that always has internet, so it uses a
 * normal online raster basemap rather than apps/mobile's offline PMTiles
 * pipeline (Protomaps extract + the pmtiles-proxy Edge Function). Nothing here
 * touches that pipeline.
 *
 * ATTRIBUTION: the tiles are CARTO's free "Positron" raster basemap rendered
 * from OpenStreetMap data. OSM data is ODbL-licensed and REQUIRES visible
 * credit, so the source below carries an `attribution` string and the map is
 * constructed with a non-compact AttributionControl — the credit is always on
 * screen, never hidden behind an (i) toggle.
 *
 * The style is raster-only and ships no glyph endpoint, so there are
 * deliberately no `symbol` layers here: territory names are rendered in the
 * side panel, not as map labels.
 */
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-Mitwirkende &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

export const SOURCE_BASEMAP = 'basemap';
export const SOURCE_TERRITORIES = 'territories';
export const SOURCE_HOUSES = 'houses';
export const SOURCE_DRAFT = 'draft';

export const LAYER_TERRITORY_FILL = 'territory-fill';
export const LAYER_TERRITORY_LINE = 'territory-line';
export const LAYER_HOUSE_CIRCLE = 'house-circle';
export const LAYER_DRAFT_FILL = 'draft-fill';
export const LAYER_DRAFT_LINE = 'draft-line';
export const LAYER_DRAFT_VERTEX = 'draft-vertex';

/** Germany, as the frame before any territory bounds are known. */
export const FALLBACK_CENTER: [number, number] = [10.45, 51.16];
export const FALLBACK_ZOOM = 5;

export const basemapStyle: MapOptions['style'] = {
  version: 8,
  sources: {
    [SOURCE_BASEMAP]: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: BASEMAP_ATTRIBUTION,
    },
  },
  layers: [{ id: SOURCE_BASEMAP, type: 'raster', source: SOURCE_BASEMAP }],
};

/**
 * Overlay layers, added once the style has loaded. Colours come from the token
 * SSOT only — never a literal hex in a component. A territory feature's
 * `selected` property drives the Porch-Amber highlight; house circles use the
 * mobile-mirrored traffic-light hues, always accompanied by the labelled
 * legend beside the map (never colour alone).
 */
export const overlayLayers: readonly AddLayerObject[] = [
  {
    id: LAYER_TERRITORY_FILL,
    type: 'fill',
    source: SOURCE_TERRITORIES,
    paint: {
      'fill-color': ['case', ['get', 'selected'], tokens.color.accent, tokens.color.ink],
      'fill-opacity': ['case', ['get', 'selected'], 0.22, 0.08],
    },
  },
  {
    id: LAYER_TERRITORY_LINE,
    type: 'line',
    source: SOURCE_TERRITORIES,
    paint: {
      'line-color': ['case', ['get', 'selected'], tokens.color.accent, tokens.color.ink],
      'line-width': ['case', ['get', 'selected'], 3, 1.5],
    },
  },
  {
    id: LAYER_HOUSE_CIRCLE,
    type: 'circle',
    source: SOURCE_HOUSES,
    paint: {
      'circle-radius': 6,
      'circle-color': [
        'match',
        ['get', 'status'],
        'new',
        tokens.houseStatus.new,
        'not_home',
        tokens.houseStatus.not_home,
        'follow_up',
        tokens.houseStatus.follow_up,
        'no_interest',
        tokens.houseStatus.no_interest,
        'blacklist',
        tokens.houseStatus.blacklist,
        'success',
        tokens.houseStatus.success,
        tokens.houseStatus.new,
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  },
  {
    id: LAYER_DRAFT_FILL,
    type: 'fill',
    source: SOURCE_DRAFT,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': tokens.color.accent, 'fill-opacity': 0.18 },
  },
  {
    id: LAYER_DRAFT_LINE,
    type: 'line',
    source: SOURCE_DRAFT,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': tokens.color.accent, 'line-width': 2, 'line-dasharray': [2, 1] },
  },
  {
    id: LAYER_DRAFT_VERTEX,
    type: 'circle',
    source: SOURCE_DRAFT,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': tokens.color.accent,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
    },
  },
];
