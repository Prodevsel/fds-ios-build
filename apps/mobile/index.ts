import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures whether you load the app in the Expo Dev Client or a native build,
// the environment is set up appropriately.
registerRootComponent(App);
