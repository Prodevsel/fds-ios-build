import { describe, expect, it } from "vitest";
import type { ConfigContext } from "expo/config";
import buildConfig from "../../app.config";

// SET-03 / D-05 / D-07: config-as-data assertion that the app declares both
// shipped UI locales (de, en) to the OS via the expo-localization config
// plugin for BOTH iOS and Android. This proves the declaration exists at the
// app.config.ts level without requiring a native prebuild.
describe("app.config.ts supportedLocales declaration", () => {
  it("declares de + en for both iOS and Android via the expo-localization plugin", () => {
    const minimalContext = {
      config: { expo: { plugins: [] } },
    } as unknown as ConfigContext;

    const result = buildConfig(minimalContext);

    const localizationEntry = result.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-localization",
    );

    expect(localizationEntry).toBeDefined();

    const [, options] = localizationEntry as [
      string,
      { supportedLocales: { ios: string[]; android: string[] } },
    ];

    expect(options.supportedLocales.ios).toEqual(["de", "en"]);
    expect(options.supportedLocales.android).toEqual(["de", "en"]);
  });
});
