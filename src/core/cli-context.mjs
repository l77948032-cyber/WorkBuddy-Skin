import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApplicationContext } from "./application-context.mjs";
import { PROJECT_ROOT } from "./paths.mjs";
import { VersionedRuntimeInstaller } from "./versioned-runtime-installer.mjs";
import {
  createWorkBuddyTargetRegistration,
  WORKBUDDY_PLUGIN_ID,
} from "./workbuddy-application-context.mjs";

export { WORKBUDDY_PLUGIN_ID };

function isWindowsPath(value) {
  return path.win32.isAbsolute(value) || value.includes("\\");
}

function resolveDataPath(value, platform) {
  return platform === "win32" && isWindowsPath(value)
    ? path.win32.resolve(value)
    : path.resolve(value);
}

function dataPathApi(value, platform) {
  return platform === "win32" && isWindowsPath(value) ? path.win32 : path;
}

function defaultUserDataRoot(platform = process.platform, homeDir = os.homedir(), environment = process.env) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "WorkBuddy Skin");
  }
  if (platform === "win32") {
    const roamingRoot = environment.APPDATA
      || path.win32.join(homeDir, "AppData", "Roaming");
    return path.win32.join(roamingRoot, "WorkBuddy Skin");
  }
  return path.join(
    environment.XDG_CONFIG_HOME || path.join(homeDir, ".config"),
    "workbuddy-skin",
  );
}

function legacyDataCandidates(platform, homeDir, environment) {
  if (platform === "darwin") {
    const applicationSupport = path.join(homeDir, "Library", "Application Support");
    return [
      {
        userDataRoot: path.join(applicationSupport, "DreamSkin"),
        dataRoot: path.join(applicationSupport, "DreamSkin", "data"),
      },
      {
        userDataRoot: path.join(applicationSupport, "DreamSkin Studio"),
        dataRoot: path.join(applicationSupport, "DreamSkin Studio", "dreamskin"),
      },
    ];
  }
  if (platform === "win32") {
    const roamingRoot = environment.APPDATA
      || path.win32.join(homeDir, "AppData", "Roaming");
    return [
      {
        userDataRoot: path.win32.join(roamingRoot, "DreamSkin"),
        dataRoot: path.win32.join(roamingRoot, "DreamSkin", "data"),
      },
      {
        userDataRoot: path.win32.join(roamingRoot, "DreamSkin Studio"),
        dataRoot: path.win32.join(roamingRoot, "DreamSkin Studio", "dreamskin"),
      },
    ];
  }
  const configRoot = environment.XDG_CONFIG_HOME || path.join(homeDir, ".config");
  return [
    {
      userDataRoot: path.join(configRoot, "dreamskin"),
      dataRoot: path.join(configRoot, "dreamskin", "data"),
    },
    {
      userDataRoot: path.join(configRoot, "dreamskin-studio"),
      dataRoot: path.join(configRoot, "dreamskin-studio", "dreamskin"),
    },
  ];
}

function hasLegacyWorkBuddyData(dataRoot) {
  return fs.existsSync(path.join(dataRoot, "themes", WORKBUDDY_PLUGIN_ID))
    || fs.existsSync(path.join(dataRoot, "state", WORKBUDDY_PLUGIN_ID, "library.json"));
}

function hasStandaloneThemes(dataRoot) {
  return fs.existsSync(path.join(dataRoot, "themes"));
}

function defaultRuntimeStateRoot(platform, homeDir, environment) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "WorkBuddyDreamSkin");
  }
  if (platform === "win32") {
    const localRoot = environment.LOCALAPPDATA
      || path.win32.join(homeDir, "AppData", "Local");
    return path.win32.join(localRoot, "WorkBuddyDreamSkin");
  }
  return path.join(homeDir, ".local", "state", "WorkBuddyDreamSkin");
}

function workBuddyPaths({ resourceRoot, dataRoot, platform, namespaced = false }) {
  const dataPath = dataPathApi(dataRoot, platform);
  const resourcePath = dataPathApi(resourceRoot, platform);
  const stateRoot = dataPath.join(dataRoot, "state", WORKBUDDY_PLUGIN_ID);
  const pluginRoot = resourcePath.join(resourceRoot, "plugins", "workbuddy");
  const namespace = namespaced ? [WORKBUDDY_PLUGIN_ID] : [];
  return Object.freeze({
    pluginId: WORKBUDDY_PLUGIN_ID,
    pluginRoot,
    pluginManifestPath: resourcePath.join(pluginRoot, "plugin.json"),
    catalogThemesRoot: resourcePath.join(pluginRoot, "catalog"),
    registryPath: resourcePath.join(pluginRoot, "resources", "components.v1.json"),
    themesRoot: dataPath.join(dataRoot, "themes", ...namespace),
    dataRoot: stateRoot,
    backupsRoot: dataPath.join(dataRoot, "backups", ...namespace),
    manifestPath: dataPath.join(stateRoot, "library.json"),
  });
}

export function resolveWorkBuddyCliPaths({
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  const resourceRoot = path.resolve(environment.WORKBUDDY_SKIN_RESOURCE_ROOT || PROJECT_ROOT);
  const explicitUserDataRoot = environment.WORKBUDDY_SKIN_USER_DATA_ROOT;
  const explicitDataRoot = environment.WORKBUDDY_SKIN_DATA_ROOT;
  const standaloneUserDataRoot = resolveDataPath(
    explicitUserDataRoot || defaultUserDataRoot(platform, homeDir, environment),
    platform,
  );
  const standaloneDataRoot = resolveDataPath(
    explicitDataRoot || dataPathApi(standaloneUserDataRoot, platform).join(standaloneUserDataRoot, "data"),
    platform,
  );
  const legacyData = !explicitUserDataRoot
    && !explicitDataRoot
    && !hasStandaloneThemes(standaloneDataRoot)
    ? legacyDataCandidates(platform, homeDir, environment).find(({ dataRoot: candidate }) => (
      hasLegacyWorkBuddyData(candidate)
    ))
    : undefined;
  const userDataRoot = resolveDataPath(legacyData?.userDataRoot || standaloneUserDataRoot, platform);
  const dataRoot = resolveDataPath(legacyData?.dataRoot || standaloneDataRoot, platform);
  const runtimeStateRoot = resolveDataPath(
    environment.WORKBUDDY_SKIN_RUNTIME_STATE_ROOT
      || defaultRuntimeStateRoot(platform, homeDir, environment),
    platform,
  );
  return Object.freeze({
    resourceRoot,
    userDataRoot,
    dataRoot,
    migratedFromLegacy: Boolean(legacyData),
    packaged: environment.WORKBUDDY_SKIN_PACKAGED === "1",
    runtimeStateRoot,
    target: workBuddyPaths({
      resourceRoot,
      dataRoot,
      platform,
      namespaced: Boolean(legacyData),
    }),
  });
}

async function installCliRuntime(paths) {
  const sourceRoot = path.join(
    paths.resourceRoot,
    "build",
    "cli-runtime",
    WORKBUDDY_PLUGIN_ID,
  );
  try {
    const installer = new VersionedRuntimeInstaller({
      runtimeRoot: path.join(paths.dataRoot, "runtime"),
      namespace: WORKBUDDY_PLUGIN_ID,
    });
    const installed = await installer.install({ sourceRoot });
    return installed.root;
  } catch (error) {
    if (error.code !== "RUNTIME_PACKAGE_MISSING" || paths.packaged) throw error;
    return paths.resourceRoot;
  }
}

export async function createWorkBuddyCliContext(options = {}) {
  const paths = resolveWorkBuddyCliPaths(options);
  const runtimeRoot = await installCliRuntime(paths);
  process.env.WORKBUDDY_DREAM_SKIN_HOME = paths.runtimeStateRoot;
  const target = paths.target;
  const registration = await createWorkBuddyTargetRegistration({
    themesRoot: target.themesRoot,
    dataRoot: target.dataRoot,
    backupsRoot: target.backupsRoot,
    projectRoot: paths.resourceRoot,
    pluginRoot: target.pluginRoot,
    pluginManifestPath: target.pluginManifestPath,
    catalogThemesRoot: target.catalogThemesRoot,
    registryPath: path.join(
      runtimeRoot,
      "plugins",
      "workbuddy",
      "resources",
      "components.v1.json",
    ),
    scriptsRoot: path.join(runtimeRoot, "scripts"),
    cssPath: path.join(runtimeRoot, "plugins", "workbuddy", "assets", "workbuddy-skin.css"),
    templatePath: path.join(runtimeRoot, "assets", "workbuddy-renderer-inject.js"),
    stateRoot: paths.runtimeStateRoot,
    platform: options.platform || process.platform,
  });
  const context = await createApplicationContext({
    targets: [registration],
    defaultPluginId: WORKBUDDY_PLUGIN_ID,
    projectRoot: paths.resourceRoot,
    dataRoot: paths.dataRoot,
  });
  return Object.freeze({
    paths,
    runtimeRoot,
    context,
    tool: context.tool,
    runtime: context.runtime,
    target: Object.freeze({
      pluginId: WORKBUDDY_PLUGIN_ID,
      targetId: registration.plugin.manifest.target.id,
      name: registration.plugin.manifest.target.name,
      version: registration.plugin.manifest.version,
      platforms: [...registration.plugin.manifest.target.platforms],
      supported: registration.plugin.manifest.target.platforms.includes(
        options.platform || process.platform,
      ),
    }),
    async close() {
      await context.pluginManager.deactivate(WORKBUDDY_PLUGIN_ID);
    },
  });
}
