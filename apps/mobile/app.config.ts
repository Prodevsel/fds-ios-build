import type { ConfigContext, ExpoConfig } from "expo/config";

// SDK 56 removed `newArchEnabled` from the ExpoConfig type because the New Architecture
// is now the only supported architecture (mandatory since SDK 55, no legacy fallback).
// We keep the explicit key for tooling/CI clarity (expo-doctor, `must_haves.truths` in the
// plan) — it's a harmless no-op flag at runtime, so we widen the type locally instead of
// escaping into `any` (CONVENTIONS.md: no `any`).
type ExpoConfigWithExplicitNewArch = ExpoConfig & { newArchEnabled: true };

// Expo SDK 56 app config for the FrontDoorSales sales-rep app.
// New Architecture only (mandatory from SDK 55) — Dev Client only, Expo Go is not targeted.
export default ({ config }: ConfigContext): ExpoConfigWithExplicitNewArch => ({
  ...config,
  name: "FrontDoorSales",
  slug: "frontdoorsales-mobile",
  scheme: "frontdoorsales",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    ...config.ios,
    supportsTablet: true,
    bundleIdentifier: "com.frontdoorsales.mobile",
    deploymentTarget: "16.4",
    infoPlist: {
      ...config.ios?.infoPlist,
      // react-native-vision-camera@5.1.0 (Nitro rewrite) ships no Expo config plugin
      // (confirmed at implementation time: no app.plugin.js in the published package, no
      // cameraPermissionText handling anywhere in lib/src — the plugin config API from
      // v3/v4 was dropped in the Nitro rewrite). Declare the camera permission directly
      // instead of referencing it as a plugin (see 01-RESEARCH.md Pitfall on partial v5 migration).
      NSCameraUsageDescription:
        "FrontDoorSales needs access to your camera to scan ID documents and IBANs.",
      // Phase 4 (CHKT/SIGN), FC-04/Pitfall 4: foreground-only, one-shot GPS fix
      // recorded at the moment of signature (SIGN-03 audit package) — never
      // continuous tracking. WhenInUse only, never Always/background.
      NSLocationWhenInUseUsageDescription:
        "FrontDoorSales benötigt Ihren Standort einmalig beim Signieren, um den Vertragsabschluss im Prüfprotokoll zu dokumentieren.",
      // Demo builds only, gated on an env var the demo workflow sets and nothing else does.
      // Expo's release default is NSAllowsArbitraryLoads:false + NSAllowsLocalNetworking:true,
      // and that local-networking exemption covers only 10/8, 172.16/12, 192.168/16 and
      // 169.254/16 — NOT Tailscale's 100.64/10 CGNAT range. A demo IPA has to reach the
      // laptop's backend from whatever network the customer site happens to have, so it
      // talks to a Tailscale address over cleartext and ATS must be told to allow it.
      // A release build never sets this flag and keeps the strict default.
      ...(process.env.EXPO_PUBLIC_DEMO_INSECURE_ATS === "1"
        ? {
            NSAppTransportSecurity: {
              NSAllowsArbitraryLoads: true,
              NSAllowsLocalNetworking: true,
            },
          }
        : {}),
    },
  },
  android: {
    ...config.android,
    package: "com.frontdoorsales.mobile",
    permissions: [
      ...(config.android?.permissions ?? []),
      "android.permission.CAMERA",
      // 02-06 (MAP-02 follow-up scheduling), Pitfall 4: without
      // SCHEDULE_EXACT_ALARM, Android 12+ Doze/App Standby may batch a
      // scheduled DATE-trigger notification and fire it minutes late —
      // undermining a time-sensitive sales follow-up. POST_NOTIFICATIONS is
      // the Android 13+ runtime notification-permission gate. Both only take
      // effect on-device after an `expo prebuild` + APK rebuild (Task 3).
      "android.permission.SCHEDULE_EXACT_ALARM",
      "android.permission.POST_NOTIFICATIONS",
      // Phase 4 (CHKT/SIGN), FC-04/Pitfall 4: foreground-only fix at signature
      // time (SIGN-03). NEVER add ACCESS_BACKGROUND_LOCATION — the project's
      // Out-of-Scope guardrail explicitly forbids continuous rep tracking.
      "android.permission.ACCESS_FINE_LOCATION",
    ],
  },
  plugins: [
    [
      // minSdk 26: react-native-vision-camera-ocr-plus uses AHardwareBuffer JNI
      // APIs (introduced in Android 26); target fleet is Android 15 tablets.
      "expo-build-properties",
      { android: { minSdkVersion: 26 } },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to use the microphone for voice notes.",
        speechRecognitionPermission: "Allow $(PRODUCT_NAME) to use speech recognition for voice notes.",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"],
      },
    ],
    "@maplibre/maplibre-react-native",
    "expo-secure-store",
    // expo-local-authentication (15-01, human-approved at the package gate; SEC-03 biometric
    // fast path, D-10). Ships its own app.plugin.js (confirmed by direct inspection of
    // node_modules/expo-local-authentication/plugin/src/withLocalAuthentication.ts at 56.0.5)
    // that sets NSFaceIDUsageDescription and the Android USE_BIOMETRIC/USE_FINGERPRINT
    // permissions — NEVER hand-edit Info.plist/AndroidManifest.xml directly for this, same
    // discipline as expo-image-picker/expo-localization below.
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "FrontDoorSales nutzt Face ID, um die App zu entsperren.",
      },
    ],
    // expo-image-picker (installed 12-01, human-approved at the package
    // gate; used by 12-14's profile-avatar picker, SET-10/D-03). Declares
    // the iOS photo-library usage description via the plugin's
    // `photosPermission` option — NEVER hand-edit Info.plist/AndroidManifest.xml
    // directly (expo prebuild --clean regenerates and silently wipes hand
    // edits, same discipline as the expo-localization plugin below).
    [
      "expo-image-picker",
      {
        photosPermission:
          "FrontDoorSales benötigt Zugriff auf deine Fotos, um ein Profilfoto auszuwählen.",
      },
    ],
    // expo-notifications: native module installed in 02-05; 02-06 adds the
    // exact-alarm/notification permissions above (Pitfall 4) — the plugin
    // itself needs no config-plugin options for this.
    "expo-notifications",
    // expo-localization config plugin (SET-03, D-05, D-07): declares the app's
    // shipped UI locales to the OS at prebuild time. This generates
    // CFBundleLocalizations (Info.plist) on iOS and locale_config.xml on
    // Android — NEVER hand-edit those generated files directly, since
    // `expo prebuild --clean` regenerates (and would silently wipe) them.
    [
      "expo-localization",
      {
        supportedLocales: {
          ios: ["de", "en"],
          android: ["de", "en"],
        },
      },
    ],
  ],
  // expo-screen-capture@56.0.5 (15-01, human-approved at the package gate; SEC-05
  // screenshot/recording protection, D-13/D-14a) ships no Expo config plugin (confirmed at
  // implementation time 2026-08-21: no "expo" key in node_modules/expo-screen-capture/package.json,
  // no app.plugin.js at the package root, expo-module.config.json declares only the native
  // ScreenCaptureModule autolinking entry — same three checks 14-DEV-CLIENT-REBUILD.md ran for
  // expo-linking). Its APIs (`preventScreenCaptureAsync`, `enableAppSwitcherProtectionAsync`)
  // require no Info.plist/AndroidManifest.xml permission string at all — unlike
  // react-native-vision-camera above, there is no usage-description key to declare directly
  // either. Autolinking alone picks up the native module at the next dev-client rebuild.
  //
  // op-sqlite native config lives in apps/mobile/package.json ("op-sqlite": { "sqlcipher": true }),
  // consumed by the op-sqlite Expo config plugin / autolinking at prebuild time.
  extra: {
    ...config.extra,
  },
});
