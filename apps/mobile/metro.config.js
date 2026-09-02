// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Phase 2 Plan 01 (02-01 PMTiles spike): register `.pmtiles` as a bundleable
// binary asset so `require("../../../assets/test-territory.pmtiles")` resolves
// via expo-asset (Asset.fromModule/downloadAsync) instead of Metro treating it
// as an unrecognized source file. Metro's default assetExts list has no GIS
// file formats — this is additive, does not affect any other extension.
config.resolver.assetExts.push("pmtiles");

// PowerSync-recommended Metro config (per @powersync/react-native README, "Metro config (optional)"):
// avoids the "Super expression must either be null or a function" inline-requires error
// by blocking inline requires for the @powersync/react-native package.
// https://github.com/powersync-ja/powersync-js/tree/main/packages/react-native#metro-config-optional
config.transformer.getTransformOptions = async () => ({
  transform: {
    inlineRequires: {
      blockList: {
        [require.resolve("@powersync/react-native")]: true,
      },
    },
  },
});

module.exports = config;
