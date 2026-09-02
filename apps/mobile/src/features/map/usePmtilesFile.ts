import { useEffect, useState } from 'react';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/auth/supabase';
import { getSupabaseFunctionsUrl } from '../../lib/auth/supabase';

/**
 * PMTiles tile-loading hook — MAP-03.
 *
 * PMTILES-SPIKE.md VERDICT: FAIL (physical device, 2026-07-20) —
 * `@maplibre/maplibre-react-native@11.3.6`'s native Android HTTP stack
 * cannot parse `pmtiles://file://` resource URLs ("Unable to parse
 * resourceUrl"). This hook implements the documented STACK.md fallback
 * instead of the native path:
 *
 * - `supabase/functions/pmtiles-proxy` serves individual XYZ vector tiles
 *   extracted server-side from the team's `.pmtiles` archive over plain
 *   https:// URLs — MapLibre RN's `VectorSource.tiles` prop is a standard
 *   tile-URL-template array, no custom protocol parsing involved, so the
 *   native failure mode above never triggers.
 * - Full-offline rendering (MAP-03) is achieved via MapLibre Native's own
 *   `OfflineManager`: while online, an offline pack is pre-downloaded for
 *   the territory bbox (populating the native ambient tile cache). The
 *   SAME tile URL template then renders from that cache once offline — no
 *   network round-trip needed after the initial download, mirroring how
 *   the native `pmtiles://` path would have worked had it not failed.
 *
 * Never returns a `localPath` (that was the PASS-verdict shape); returns a
 * `tileUrlTemplate` instead, per the spike's documented fallback shape.
 */

export type PmtilesFileStatus = 'loading' | 'downloading' | 'ready' | 'missing' | 'error';

export type TerritoryBounds = [west: number, south: number, east: number, north: number];

export interface UsePmtilesFileOptions {
  teamId: string | null;
  territoryId: string | null;
  /** Territory bbox for the offline pre-fetch; omit to skip offline packing. */
  bounds: TerritoryBounds | null;
  /** DI seam for tests — defaults to the app-wide Supabase client singleton. */
  supabase?: SupabaseClient;
  /** DI seam for tests — defaults to EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL. */
  edgeFunctionBaseUrl?: string;
  /** DI seam for tests — defaults to MapLibre RN's OfflineManager singleton. */
  offlineManager?: OfflineManagerLike;
}

/** Narrow slice of OfflineManager's API this hook depends on (test DI seam). */
export type OfflineManagerLike = Pick<typeof OfflineManager, 'getPack' | 'createPack'> &
  Partial<Pick<typeof OfflineManager, 'deletePack'>>;

export interface UsePmtilesFileResult {
  /** XYZ tile URL template (`.../{z}/{x}/{y}.mvt?token=...`) for VectorSource.tiles. */
  tileUrlTemplate: string | null;
  status: PmtilesFileStatus;
  error: string | null;
}

export function usePmtilesFile(options: UsePmtilesFileOptions): UsePmtilesFileResult {
  const { teamId, territoryId, bounds } = options;
  const supabase = options.supabase ?? getSupabase();
  const offlineManager = options.offlineManager ?? OfflineManager;

  const [status, setStatus] = useState<PmtilesFileStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tileUrlTemplate, setTileUrlTemplate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!teamId || !territoryId) {
      setStatus('missing');
      setTileUrlTemplate(null);
      return;
    }

    async function run() {
      try {
        setStatus('loading');

        const edgeFunctionBaseUrl = options.edgeFunctionBaseUrl ?? requireEdgeFunctionBaseUrl();
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (sessionError || !token) {
          throw new Error('no authenticated session — cannot build a signed tile URL');
        }

        const base = `${edgeFunctionBaseUrl}/pmtiles-proxy/${teamId}/${territoryId}`;
        const tileTemplate = `${base}/{z}/{x}/{y}.mvt?token=${encodeURIComponent(token)}`;
        if (cancelled) return;
        setTileUrlTemplate(tileTemplate);

        if (bounds) {
          setStatus('downloading');
          try {
            // v2: the v1 pack was created from a style without glyphs/
            // text-font and retries default-stack glyph downloads forever —
            // delete it once, best-effort.
            await offlineManager.deletePack?.(`territory-${territoryId}`).catch(() => {});
            await ensureOfflinePack(offlineManager, {
              packId: `territory-${territoryId}-v2`,
              styleUrl: `${base}/style.json?token=${encodeURIComponent(token)}`,
              bounds,
            });
          } catch (packError) {
            // No existing offline pack AND the pre-fetch failed (typically:
            // no network yet, region never downloaded) — this is the
            // "Kartendaten fehlen" empty-state case, not a generic error.
            if (cancelled) return;
            setError(packError instanceof Error ? packError.message : 'offline pack download failed');
            setStatus('missing');
            return;
          }
        }

        if (cancelled) return;
        setStatus('ready');
        setError(null);
      } catch (runError) {
        if (cancelled) return;
        setError(runError instanceof Error ? runError.message : 'unknown error');
        setStatus('error');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, territoryId, bounds?.join(','), supabase, offlineManager, options.edgeFunctionBaseUrl]);

  return { tileUrlTemplate, status, error };
}

async function ensureOfflinePack(
  offlineManager: OfflineManagerLike,
  opts: { packId: string; styleUrl: string; bounds: TerritoryBounds },
) {
  const existing = await offlineManager.getPack(opts.packId).catch(() => null);
  if (existing) {
    return existing;
  }
  return offlineManager.createPack(
    {
      mapStyle: opts.styleUrl,
      bounds: opts.bounds,
      minZoom: 0,
      maxZoom: 15,
      metadata: { packId: opts.packId },
    },
    () => {
      // Progress is surfaced via the hook's 'downloading' status, not a
      // per-tile callback — this phase doesn't need a progress bar.
    },
    (_pack, packError) => {
      // Logged, not thrown — createPack's own promise rejection/resolution
      // (awaited by the caller) is the source of truth for pack failure.
      console.warn('offline pack error', packError);
    },
  );
}

function requireEdgeFunctionBaseUrl(): string {
  // Honours the demo-only runtime backend override before the compiled-in value,
  // so a demo that moves to another network does not need a rebuilt bundle.
  const value = getSupabaseFunctionsUrl();
  if (!value) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is not set — define it in the app environment (Supabase Edge Functions base URL, e.g. https://<project-ref>.supabase.co/functions/v1)',
    );
  }
  return value;
}
