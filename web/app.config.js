import packageJson from "./package.json" with { type: "json" };

export default {
  name: "Connector Foundry",
  slug: "connector-foundry",
  version: packageJson.version,
  ios: {
    bundleIdentifier: "com.connectorfoundry.app",
  },
  android: {
    package: "com.connectorfoundry.app",
  },
};
