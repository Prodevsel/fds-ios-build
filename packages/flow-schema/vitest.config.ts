import { defineConfig } from 'vitest/config';

/**
 * Unit-test config for the form-engine schema SSOT (`packages/flow-schema`).
 *
 * Pure logic package (zod schemas + evaluator helpers) — no React Native or
 * native module dependencies, so a plain Node environment is sufficient.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
