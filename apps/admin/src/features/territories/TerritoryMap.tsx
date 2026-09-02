import {
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  NavigationControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as React from 'react';
import {
  draftToFeatureCollection,
  housesToFeatureCollection,
  territoriesToFeatureCollection,
} from './mapFeatures';
import {
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  LAYER_TERRITORY_FILL,
  SOURCE_DRAFT,
  SOURCE_HOUSES,
  SOURCE_TERRITORIES,
  basemapStyle,
  overlayLayers,
} from './mapStyle';
import { boundsOf, type Position } from './polygon';
import type { House, Territory } from './useTerritoryData';

/**
 * MapLibre GL JS canvas for the Gebiete screen: the team's territory polygons,
 * their houses in traffic-light colours, and a mouse-driven polygon draw mode.
 *
 * Drawing is hand-rolled on top of a plain GeoJSON source rather than pulling
 * in a draw plugin: the interaction this screen needs is "click to place a
 * corner, click Fertig to close", and a dependency that mainly exists for
 * vertex dragging and multi-feature editing would be more surface than the
 * feature is worth.
 *
 * The map instance lives outside React state on purpose — it owns a WebGL
 * context and must be created exactly once. Props are mirrored into refs so
 * the click handlers registered at creation time always read current values
 * without being re-bound on every render.
 */

export interface TerritoryMapProps {
  territories: readonly Territory[];
  houses: readonly House[];
  selectedTerritoryId: string | null;
  onSelectTerritory: (territoryId: string | null) => void;
  /** True while the user is placing corners. */
  drawing: boolean;
  draftPoints: readonly Position[];
  onDraftPointsChange: (points: Position[]) => void;
  /** aria-label for the map canvas (i18n copy). */
  label: string;
}

export function TerritoryMap({
  territories,
  houses,
  selectedTerritoryId,
  onSelectTerritory,
  drawing,
  draftPoints,
  onDraftPointsChange,
  label,
}: TerritoryMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const [ready, setReady] = React.useState(false);

  // Latest-props mirrors for the once-registered map event handlers.
  const drawingRef = React.useRef(drawing);
  const draftRef = React.useRef(draftPoints);
  const onDraftChangeRef = React.useRef(onDraftPointsChange);
  const onSelectRef = React.useRef(onSelectTerritory);
  drawingRef.current = drawing;
  draftRef.current = draftPoints;
  onDraftChangeRef.current = onDraftPointsChange;
  onSelectRef.current = onSelectTerritory;

  /** Create the map exactly once, then add the overlay sources + layers. */
  React.useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const map = new MapLibreMap({
      container,
      style: basemapStyle,
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
      // ODbL: the OSM/CARTO credit stays expanded, never behind an (i) toggle.
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    const empty = { type: 'FeatureCollection' as const, features: [] };
    map.on('load', () => {
      map.addSource(SOURCE_TERRITORIES, { type: 'geojson', data: empty });
      map.addSource(SOURCE_HOUSES, { type: 'geojson', data: empty });
      map.addSource(SOURCE_DRAFT, { type: 'geojson', data: empty });
      for (const layer of overlayLayers) {
        map.addLayer(layer);
      }

      map.on('click', LAYER_TERRITORY_FILL, (event: MapLayerMouseEvent) => {
        if (drawingRef.current) {
          return; // in draw mode a click places a corner, never selects
        }
        const properties = event.features?.[0]?.properties;
        const id = properties?.['territoryId'];
        if (typeof id === 'string') {
          onSelectRef.current(id);
        }
      });

      map.on('click', (event: MapMouseEvent) => {
        if (!drawingRef.current) {
          return;
        }
        const next: Position[] = [
          ...draftRef.current.map((p) => [p[0], p[1]] as Position),
          [event.lngLat.lng, event.lngLat.lat],
        ];
        onDraftChangeRef.current(next);
      });

      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  /** Draw mode owns the click, so double-click zoom must not fight it. */
  React.useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) {
      return;
    }
    if (drawing) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  }, [drawing, ready]);

  const setData = React.useCallback(
    (sourceId: string, data: object) => {
      const map = mapRef.current;
      if (map === null || !ready) {
        return;
      }
      const source = map.getSource(sourceId);
      if (source instanceof GeoJSONSource) {
        source.setData(data as never);
      }
    },
    [ready],
  );

  React.useEffect(() => {
    setData(SOURCE_TERRITORIES, territoriesToFeatureCollection(territories, selectedTerritoryId));
  }, [setData, territories, selectedTerritoryId]);

  React.useEffect(() => {
    setData(SOURCE_HOUSES, housesToFeatureCollection(houses));
  }, [setData, houses]);

  React.useEffect(() => {
    setData(SOURCE_DRAFT, draftToFeatureCollection(draftPoints));
  }, [setData, draftPoints]);

  /**
   * Frame the drawn territories once, when they first arrive. Deliberately
   * keyed on the boundary extent rather than the array identity: refetches
   * must not yank a camera the user has since panned, and a map with nothing
   * drawn keeps the Germany-wide fallback view rather than flying to null
   * island.
   */
  const boundsKey = React.useMemo(() => {
    const bounds = boundsOf(
      territories.flatMap((territory) => (territory.boundary === null ? [] : [territory.boundary])),
    );
    return bounds === null ? '' : bounds.join(',');
  }, [territories]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready || boundsKey === '') {
      return;
    }
    const [west, south, east, north] = boundsKey.split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    map.fitBounds(new LngLatBounds([west, south], [east, north]), {
      padding: 48,
      duration: 0,
      maxZoom: 16,
    });
  }, [ready, boundsKey]);

  return <div ref={containerRef} aria-label={label} role="application" className="size-full" />;
}
