import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from './de/common.json';

/**
 * i18next init for apps/admin (German, single-locale MVP — CONVENTIONS.md
 * language policy: UI copy is German i18n content, never hardcoded).
 *
 * Per-feature namespaced structure: every feature owns its own copy file at
 * `src/features/<feature>/i18n/de.json`, eager-globbed here and registered
 * under `<feature>` as its i18next namespace. Later feature plans ADD a file —
 * they never edit a shared monolithic de.json, so parallel copy authorship has
 * no merge-conflict surface. Shell/nav/shared copy lives in `de/common.json`.
 */
const featureModules = import.meta.glob('../features/**/i18n/de.json', {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;

const featureResources: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(featureModules)) {
  const match = path.match(/features\/([^/]+)\/i18n\/de\.json$/);
  if (match?.[1]) {
    featureResources[match[1]] = mod.default;
  }
}

void i18n.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: 'de',
  ns: ['common', ...Object.keys(featureResources)],
  defaultNS: 'common',
  resources: {
    de: { common, ...featureResources },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
