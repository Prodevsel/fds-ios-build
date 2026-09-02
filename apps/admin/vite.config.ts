import { URL, fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite React-TS SPA for apps/admin. The admin dashboard is a pure client-side
// build talking to Supabase directly (no PowerSync/local-DB layer, unlike
// apps/mobile) — see 05-RESEARCH Architectural Responsibility Map.
//
// Since quick-260827-kunde-angebotsseite this workspace produces TWO bundles
// from one project: the dashboard (`index.html`) and the customer offer page
// (`angebot.html`). They share a toolchain and nothing else — the separation
// is enforced by scripts/ci/customer-bundle-isolation.mjs, which fails the
// build if anything under src/customer/ ever reaches dashboard code.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      // WATCH OUT: the moment `input` is set, Vite stops using index.html
      // implicitly. `admin` MUST stay listed here or the dashboard silently
      // disappears from the build output.
      // fileURLToPath(new URL(...)) rather than resolve(__dirname, ...):
      // this config is ESM, where __dirname does not exist.
      input: {
        admin: fileURLToPath(new URL('./index.html', import.meta.url)),
        angebot: fileURLToPath(new URL('./angebot.html', import.meta.url)),
      },
    },
  },
  server: {
    // The customer opens the offer link on HIS OWN phone. A dev server bound
    // only to the loopback interface is dead from there, and the whole feature
    // is worthless in a demo. `host: true` binds all interfaces.
    //
    // It also REPLACES the default `localhost` binding rather than adding to
    // it, which is what resolves the quirk recorded in HANDOFF-DEMO.md §2
    // ("Vite listens on IPv6 only — `localhost` works in the browser,
    // `127.0.0.1` via curl does not"). Root cause of that quirk: Vite's default
    // host is the literal string `localhost`, which on this machine resolves to
    // `::1` only. Verify rather than assume — `curl -s http://127.0.0.1:5174/angebot.html`
    // must return markup, not "connection refused".
    //
    // This is a DEVELOPMENT setting. In production a statically built bundle is
    // served behind TLS; `vite dev` never runs there. The customer bundle
    // carries no secret (the isolation check is what keeps that true), so
    // exposing it on the local network costs nothing.
    host: true,
    // 5174 was never configured anywhere — it was Vite's silent fallback
    // because 5173 was busy, and HANDOFF-DEMO.md then wrote it down as if it
    // were a setting. A port that drifts between runs gets baked into
    // ALREADY-SENT offer emails via CUSTOMER_PORTAL_BASE_URL and makes their
    // links dead after the fact. `strictPort` turns that silent drift into a
    // loud startup failure.
    port: 5174,
    strictPort: true,
  },
});
