import { RootNavigator } from './src/app/RootNavigator';

// Entry point. In __DEV__, mounts one of the Phase 1/2 dev-only spike screens
// (see .planning/phases/01-foundation-tenant-separation-offline-sync-native-spike/SPIKE-RESULTS.md)
// instead of the production home screen — none of these are shipped features:
// - SpikeScreen: Plan 05 native-module link probe (camera/map/speech/sqlite).
// - SkeletonFlowScreen: Plan 09 Walking Skeleton (login -> offline create ->
//   sync status), toggled via EXPO_PUBLIC_SKELETON_FLOW=1 for the device pass.
// - PmtilesSpikeScreen: Phase 2 Plan 01 (02-01) PMTiles offline-render spike
//   (MAP-03 risk gate), toggled via EXPO_PUBLIC_PMTILES_SPIKE=1. VERDICT: FAIL
//   (PMTILES-SPIKE.md) — kept only as a dev toggle for reference, superseded
//   by MapScreen's Edge Function tile-proxy fallback below.
// - StrokeSpikeScreen: Phase 4 Plan 01 (04-01) signature stroke-data spike
//   (D-19/A1 risk gate — 04-STROKE-SPIKE.md), toggled via
//   EXPO_PUBLIC_STROKE_SPIKE=1. Verifies react-native-signature-canvas's
//   getData()/onGetData point-group shape on a physical device before the
//   audit-package schema (SIGN-03) is frozen.
// - DirectSignPdfLibSpikeScreen: Phase 10 Plan 07 (10-07) SC1 on-device
//   @cantoo/pdf-lib feasibility spike (D-01, DSGN-03 — 10-PDF-LIB-SPIKE.md),
//   toggled via EXPO_PUBLIC_DIRECT_SIGN_SPIKE=1. PARALLEL/non-blocking:
//   server-side renderDirectSignPdf.ts remains the default signing path
//   regardless of this spike's outcome.
//
// WR-02: the spike screens are loaded via inline require() INSIDE the __DEV__
// branch, never via static top-level imports — Metro constant-folds __DEV__
// in release builds and strips the dead branch together with its inline
// requires, so the spike screens (and everything they transitively import,
// e.g. the fixture sign-in flow) never land in a production JS bundle.
//
// Production branch: the RootNavigator (auth gate → bottom-tab shell). The
// sales rep lands on the Login screen (or straight on the tabs if a session is
// already persisted); the Karte tab is the offline map home (MAP-01 + MAP-03).
export default function App() {
  if (__DEV__) {
    if (process.env.EXPO_PUBLIC_STROKE_SPIKE === '1') {
      type StrokeSpikeModule = typeof import('./src/features/spike/StrokeSpikeScreen');
      const strokeSpikeModule = require('./src/features/spike/StrokeSpikeScreen') as StrokeSpikeModule;
      return <strokeSpikeModule.StrokeSpikeScreen />;
    }
    if (process.env.EXPO_PUBLIC_PMTILES_SPIKE === '1') {
      type PmtilesSpikeModule = typeof import('./src/features/spike/PmtilesSpikeScreen');
      const pmtilesSpikeModule = require('./src/features/spike/PmtilesSpikeScreen') as PmtilesSpikeModule;
      return <pmtilesSpikeModule.PmtilesSpikeScreen />;
    }
    if (process.env.EXPO_PUBLIC_DIRECT_SIGN_SPIKE === '1') {
      type DirectSignSpikeModule = typeof import('./src/features/spike/DirectSignPdfLibSpikeScreen');
      const directSignSpikeModule =
        require('./src/features/spike/DirectSignPdfLibSpikeScreen') as DirectSignSpikeModule;
      return <directSignSpikeModule.DirectSignPdfLibSpikeScreen />;
    }
    if (process.env.EXPO_PUBLIC_SKELETON_FLOW === '1') {
      type SkeletonModule = typeof import('./src/features/spike/SkeletonFlowScreen');
      const skeletonModule = require('./src/features/spike/SkeletonFlowScreen') as SkeletonModule;
      return <skeletonModule.SkeletonFlowScreen />;
    }
    if (process.env.EXPO_PUBLIC_NATIVE_MODULE_SPIKE === '1') {
      type SpikeModule = typeof import('./src/features/spike/SpikeScreen');
      const spikeModule = require('./src/features/spike/SpikeScreen') as SpikeModule;
      return <spikeModule.SpikeScreen />;
    }
  }

  return <RootNavigator />;
}
