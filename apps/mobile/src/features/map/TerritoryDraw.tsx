import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { lightColors, spacing } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';
import type { TerritoriesRepo } from './db/territoriesRepo';

/**
 * MAP-04 team-lead territory drawing: tap-to-add-vertex polygon draw mode
 * (02-RESEARCH.md Anti-Patterns — never a freehand/drag gesture). Split into
 * pure, DI'd logic (below, unit-tested directly per StatusSheet.tsx's
 * pattern) + a stateful hook + two presentational pieces:
 *  - `TerritoryDrawLayer` renders the live draft polygon + vertex handles as
 *    MapView children (must live inside the `<MapView>` tree, alongside the
 *    existing territories GeoJSONSource/Layer overlay in MapScreen.tsx —
 *    reusing that exact component pair, NOT `ShapeSource`/`FillLayer`/
 *    `LineLayer` from RESEARCH.md's Code Examples, since the installed
 *    `@maplibre/maplibre-react-native` version's territories overlay already
 *    proves `GeoJSONSource`+`Layer` is the correct API surface here).
 *  - `TerritoryDrawControls` renders the persistent bottom bar (assign /
 *    discard / undo), rendered as a MapScreen sibling, outside `<MapView>`.
 * MapScreen owns the `useTerritoryDraw` hook and wires `handleMapPress` to
 * `addVertex` while draw mode is active — the two gestures (house-pin tap vs.
 * vertex-add) never fire on the same tap because MapScreen branches on
 * draw-mode state before doing any house hit-testing (UI-SPEC.md).
 */

export type TerritoryDrawRepo = Pick<TerritoriesRepo, 'submitBoundary'>;

/** Tap-to-add-vertex (MAP-04): appends the tapped point, never a drag gesture. */
export function appendVertex(
  vertices: [number, number][],
  lngLat: [number, number],
): [number, number][] {
  return [...vertices, lngLat];
}

/** Undo-last-vertex control (UI-SPEC "Letzten Punkt entfernen"). */
export function undoLastVertex(vertices: [number, number][]): [number, number][] {
  return vertices.slice(0, -1);
}

/** `Gebiet zuweisen` enables only once a valid (≥3-vertex) ring can be closed (UI-SPEC). */
export function canAssignTerritory(vertices: [number, number][]): boolean {
  return vertices.length >= 3;
}

/** Live draft polygon for the map preview — null until a closable ring exists. */
export function buildDraftPolygon(
  vertices: [number, number][],
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const first = vertices[0];
  if (!canAssignTerritory(vertices) || !first) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[...vertices, first]] },
  };
}

export interface AssignTerritoryParams {
  repo: TerritoryDrawRepo;
  territoryId: string;
  vertices: [number, number][];
}

/**
 * `Gebiet zuweisen`: submits the closed-ring polygon via
 * `territoriesRepo.submitBoundary` — a LOCAL write the connector routes to
 * the `create_territory_boundary()` RPC (02-04) on drain. Throws below the
 * 3-vertex threshold so a caller can never submit a degenerate polygon even
 * if the disabled-button UI gate is somehow bypassed (belt and suspenders).
 */
export async function assignTerritory({
  repo,
  territoryId,
  vertices,
}: AssignTerritoryParams): Promise<void> {
  const draft = buildDraftPolygon(vertices);
  if (!draft) {
    throw new Error('assignTerritory requires at least 3 vertices to close a ring');
  }
  await repo.submitBoundary(territoryId, draft.geometry);
}

export interface UseTerritoryDrawOptions {
  repo: TerritoryDrawRepo;
  territoryId: string;
  /** Called after a successful submit or a confirmed discard — exits draw mode. */
  onDone: () => void;
}

export interface UseTerritoryDrawResult {
  vertices: [number, number][];
  draftFeature: GeoJSON.Feature<GeoJSON.Polygon> | null;
  canAssign: boolean;
  showDiscardConfirm: boolean;
  addVertex: (lngLat: [number, number]) => void;
  undo: () => void;
  requestDiscard: () => void;
  cancelDiscard: () => void;
  confirmDiscard: () => void;
  assign: () => Promise<void>;
}

export function useTerritoryDraw({
  repo,
  territoryId,
  onDone,
}: UseTerritoryDrawOptions): UseTerritoryDrawResult {
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const addVertex = useCallback((lngLat: [number, number]) => {
    setVertices((prev) => appendVertex(prev, lngLat));
  }, []);

  const undo = useCallback(() => {
    setVertices((prev) => undoLastVertex(prev));
  }, []);

  const requestDiscard = useCallback(() => setShowDiscardConfirm(true), []);
  const cancelDiscard = useCallback(() => setShowDiscardConfirm(false), []);
  const confirmDiscard = useCallback(() => {
    setVertices([]);
    setShowDiscardConfirm(false);
    onDone();
  }, [onDone]);

  const assign = useCallback(async () => {
    await assignTerritory({ repo, territoryId, vertices });
    setVertices([]);
    onDone();
  }, [repo, territoryId, vertices, onDone]);

  const draftFeature = useMemo(() => buildDraftPolygon(vertices), [vertices]);

  return {
    vertices,
    draftFeature,
    canAssign: canAssignTerritory(vertices),
    showDiscardConfirm,
    addVertex,
    undo,
    requestDiscard,
    cancelDiscard,
    confirmDiscard,
    assign,
  };
}

/**
 * Draft-polygon + vertex-handle overlay — MUST be rendered inside `<MapView>`.
 * Deliberately pinned to `lightColors.accent` (not routed through
 * `useThemeColors()`, mirroring `HousePin.tsx`'s theme-invariant precedent):
 * this is live draw-mode feedback ON the map surface, same category as the
 * territory-fill/outline colours MapScreen.tsx keeps invariant, not app
 * chrome — it must read identically regardless of the rep's theme preference.
 */
export function TerritoryDrawLayer({
  vertices,
  draftFeature,
}: {
  vertices: [number, number][];
  draftFeature: GeoJSON.Feature<GeoJSON.Polygon> | null;
}) {
  return (
    <>
      {draftFeature ? (
        <GeoJSONSource id="territory-draft" data={draftFeature}>
          <Layer
            id="territory-draft-fill"
            type="fill"
            paint={{ 'fill-color': lightColors.accent, 'fill-opacity': 0.3 }}
          />
          <Layer
            id="territory-draft-outline"
            type="line"
            paint={{ 'line-color': lightColors.accent, 'line-width': 2 }}
          />
        </GeoJSONSource>
      ) : null}
      {vertices.map((vertex, index) => (
        <Marker key={`vertex-${index}-${vertex[0]}-${vertex[1]}`} id={`territory-vertex-${index}`} lngLat={vertex}>
          <View style={vertexHandleStyle.vertexHandle} />
        </Marker>
      ))}
    </>
  );
}

/** Persistent bottom bar — MUST be rendered as a MapScreen sibling, outside `<MapView>`. */
export function TerritoryDrawControls({
  canAssign,
  showDiscardConfirm,
  onAssign,
  onUndo,
  onRequestDiscard,
  onCancelDiscard,
  onConfirmDiscard,
}: {
  canAssign: boolean;
  showDiscardConfirm: boolean;
  onAssign: () => void;
  onUndo: () => void;
  onRequestDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.bar} testID="territory-draw-bar">
      {showDiscardConfirm ? (
        <View>
          <Text style={styles.confirmTitle}>{t('destructive.discardDrawingTitle')}</Text>
          <Text style={styles.confirmBody}>{t('destructive.discardDrawingBody')}</Text>
          <View style={styles.confirmRow}>
            <Pressable
              style={[styles.confirmButton, styles.cancelButton]}
              accessibilityRole="button"
              onPress={onCancelDiscard}
            >
              <Text style={styles.cancelButtonText}>{t('cta.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, styles.destructiveButton]}
              accessibilityRole="button"
              onPress={onConfirmDiscard}
            >
              <Text style={styles.destructiveButtonText}>{t('cta.discardDrawing')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable
            style={styles.undoButton}
            accessibilityRole="button"
            accessibilityLabel={t('map.removeLastVertexLabel')}
            onPress={onUndo}
          >
            <MaterialCommunityIcons name="undo" size={24} color={colors.accent} />
          </Pressable>
          <Pressable
            style={[styles.discardButton]}
            accessibilityRole="button"
            onPress={onRequestDiscard}
          >
            <Text style={styles.discardButtonText}>{t('cta.discardDrawing')}</Text>
          </Pressable>
          <Pressable
            style={[styles.assignButton, !canAssign ? styles.assignButtonDisabled : null]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAssign }}
            disabled={!canAssign}
            onPress={onAssign}
          >
            <Text style={styles.assignButtonText}>{t('cta.assignTerritory')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Theme-invariant (see TerritoryDrawLayer's doc comment above): the draw-mode
// vertex handle renders on the map surface, pinned to lightColors.accent.
const vertexHandleStyle = StyleSheet.create({
  vertexHandle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: lightColors.accent,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: spacing.lg,
      borderTopRightRadius: spacing.lg,
      padding: spacing.lg,
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    undoButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: spacing.touchTarget / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.secondary,
      marginRight: spacing.sm,
    },
    discardButton: {
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.md,
      borderRadius: spacing.sm,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    discardButtonText: { fontSize: 16, fontWeight: '400', color: colors.destructive },
    assignButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: spacing.sm,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assignButtonDisabled: { backgroundColor: colors.secondary },
    assignButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
    confirmTitle: { fontSize: 20, fontWeight: '600', color: '#0F172A', marginBottom: spacing.sm },
    confirmBody: { fontSize: 16, fontWeight: '400', color: '#334155', marginBottom: spacing.lg },
    confirmRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    confirmButton: {
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: spacing.sm,
      marginLeft: spacing.sm,
    },
    cancelButton: { backgroundColor: colors.secondary },
    cancelButtonText: { fontSize: 16, fontWeight: '400', color: '#0F172A' },
    destructiveButton: { backgroundColor: colors.destructive },
    destructiveButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  });
}
