import { defineConfig } from 'vitest/config';

/**
 * Unit-test config for the mobile app's infrastructure code (`src/lib/**`).
 *
 * Tests run in a plain Node environment — native Expo/React Native modules
 * (expo-secure-store, expo-crypto, expo-file-system, @powersync/react-native,
 * @op-engineering/op-sqlite) are NEVER loaded in tests. Modules under test
 * either import only pure-JS packages (@powersync/common) or have their
 * native imports mocked via `vi.mock`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        // The Edge Function's renderer imports pdf-lib by URL, because Deno
        // has no node_modules. `renderDirectSignPdf.drift.test.ts` imports that
        // very file to compare its OUTPUT BYTES against the device copy, and
        // without this alias Node refuses the https: specifier outright.
        //
        // Pointing both at the SAME workspace pdf-lib is what makes the
        // comparison meaningful: a byte difference is then a difference in the
        // two renderers, never in two library builds.
        find: /^https:\/\/esm\.sh\/@cantoo\/pdf-lib@[\d.]+$/,
        replacement: '@cantoo/pdf-lib',
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
