import type { GeoJsonPolygon, Position } from './polygon';
import { closeRing } from './polygon';
import type { House, Territory } from './useTerritoryData';

/**
 * Pure GeoJSON builders feeding the three overlay sources. Kept out of the map
 * component so the shapes on screen can be reasoned about (and tested) without
 * a WebGL context.
 */

interface Feature<G, P> {
  type: 'Feature';
  id?: string | number;
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}

interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

interface LineGeometry {
  type: 'LineString';
  coordinates: Position[];
}

export interface TerritoryFeatureProps {
  territoryId: string;
  name: string;
  /** Drives the highlight paint expression in `overlayLayers`. */
  selected: boolean;
}

export interface HouseFeatureProps {
  houseId: string;
  status: string;
}

/**
 * Territories that actually have a boundary. An undrawn territory contributes
 * no feature — it is listed in the side panel with an explicit "not drawn yet"
 * state instead of being given an invented shape.
 */
export function territoriesToFeatureCollection(
  territories: readonly Territory[],
  selectedId: string | null,
): FeatureCollection<GeoJsonPolygon, TerritoryFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: territories.flatMap((territory) =>
      territory.boundary === null
        ? []
        : [
            {
              type: 'Feature' as const,
              geometry: territory.boundary,
              properties: {
                territoryId: territory.id,
                name: territory.name,
                selected: territory.id === selectedId,
              },
            },
          ],
    ),
  };
}

export function housesToFeatureCollection(
  houses: readonly House[],
): FeatureCollection<PointGeometry, HouseFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: houses.map((house) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [house.lon, house.lat] as Position },
      properties: { houseId: house.id, status: house.status },
    })),
  };
}

/**
 * The in-progress drawing: every placed vertex as a Point, the open path as a
 * LineString from two vertices on, and a provisional fill from three on. The
 * fill ring is closed for display only — persistence goes through
 * `draftToPolygon`, which additionally refuses self-intersecting shapes.
 */
export function draftToFeatureCollection(
  points: readonly Position[],
): FeatureCollection<PointGeometry | LineGeometry | GeoJsonPolygon, Record<string, never>> {
  const features: Feature<PointGeometry | LineGeometry | GeoJsonPolygon, Record<string, never>>[] =
    points.map((position) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: position },
      properties: {},
    }));

  if (points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points.map((p) => [p[0], p[1]] as Position) },
      properties: {},
    });
  }
  if (points.length >= 3) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closeRing(points)] },
      properties: {},
    });
  }
  return { type: 'FeatureCollection', features };
}
