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
  extra: {
    eas: {
      projectId: "59d22e44-1f50-402c-af7f-013e06c87521",
    },
  },
};
