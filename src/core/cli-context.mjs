import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createApplicationContext,
  createTraeTargetRegistration,
} from "./application-context.mjs";
import { ToolError } from "./errors.mjs";
import { PROJECT_ROOT } from "./paths.mjs";
import { VersionedRuntimeInstaller } from "./versioned-runtime-installer.mjs";
import {
  createWorkBuddyTargetRegistration,
  WORKBUDDY_PLUGIN_ID,
} from "./workbuddy-application-context.mjs";

export const DREAMSKIN_PLUGIN_IDS = Object.freeze([
  "dreamskin.trae",
  "dreamskin.workbuddy",
]);

function defaultUserDataRoot(platform = process.platform, homeDir = os.homedir(), environment = process.env) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "DreamSkin");
  }
  if (platform === "win32") {
    return path.join(
      environment.APPDATA || path.join(homeDir, "AppData", "Roaming"),
      "DreamSkin",
    );
  }
  return path.join(environment.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "dreamskin");
}

function legacyUserDataRoot(platform = process.platform, homeDir = os.homedir(), environment = process.env) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "DreamSkin Studio");
  }
  if (platform === "win32") {
    return path.join(
      environment.APPDATA || path.join(homeDir, "AppData", "Roaming"),
      "DreamSkin Studio",
    );
  }
  return path.join(environment.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "dreamskin-studio");
}

function targetPaths({ resourceRoot, dataRoot, pluginId, directory }) {
  const stateRoot = path.join(dataRoot, "state", pluginId);
  const pluginRoot = path.join(resourceRoot, "plugins", directory);
  return Object.freeze({
    pluginId,
    pluginRoot,
    pluginManifestPath: path.join(pluginRoot, "plugin.json"),
    catalogThemesRoot: path.join(pluginRoot, "catalog"),
    registryPath: path.join(pluginRoot, "resources", "components.v1.json"),
    themesRoot: path.join(dataRoot, "themes", pluginId),
    dataRoot: stateRoot,
    backupsRoot: path.join(dataRoot, "backups", pluginId),
    manifestPath: path.join(stateRoot, "library.json"),
  });
}

export function resolveDreamSkinCliPaths({
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  const resourceRoot = path.resolve(environment.DREAMSKIN_RESOURCE_ROOT || PROJECT_ROOT);
  const explicitUserDataRoot = environment.DREAMSKIN_USER_DATA_ROOT;
  const explicitDataRoot = environment.DREAMSKIN_DATA_ROOT;
  const legacyRoot = legacyUserDataRoot(platform, homeDir, environment);
  const legacyDataRoot = path.join(legacyRoot, "dreamskin");
  const useLegacyData = !explicitUserDataRoot
    && !explicitDataRoot
    && fs.existsSync(legacyDataRoot);
  const userDataRoot = path.resolve(
    explicitUserDataRoot
      || (useLegacyData ? legacyRoot : defaultUserDataRoot(platform, homeDir, environment)),
  );
  const dataRoot = path.resolve(
    explicitDataRoot
      || (useLegacyData ? legacyDataRoot : path.join(userDataRoot, "data")),
  );
  const appDataRoot = path.dirname(userDataRoot);
  const trae = targetPaths({
    resourceRoot,
    dataRoot,
    pluginId: "dreamskin.trae",
    directory: "trae",
  });
  const workBuddy = targetPaths({
    resourceRoot,
    dataRoot,
    pluginId: "dreamskin.workbuddy",
    directory: "workbuddy",
  });
  return Object.freeze({
    resourceRoot,
    userDataRoot,
    dataRoot,
    migratedFromStudio: useLegacyData,
    packaged: environment.DREAMSKIN_PACKAGED === "1",
    runtimeStateRoots: Object.freeze({
      "dreamskin.trae": path.resolve(
        environment.DREAMSKIN_TRAE_RUNTIME_STATE_ROOT || path.join(appDataRoot, "TraeDreamSkin"),
      ),
      "dreamskin.workbuddy": path.resolve(
        environment.DREAMSKIN_WORKBUDDY_RUNTIME_STATE_ROOT || path.join(appDataRoot, "WorkBuddyDreamSkin"),
      ),
    }),
    targets: Object.freeze({
      "dreamskin.trae": trae,
      "dreamskin.workbuddy": workBuddy,
    }),
  });
}

function selectedPluginIds(pluginIds) {
  const values = pluginIds === undefined ? DREAMSKIN_PLUGIN_IDS : pluginIds;
  if (!Array.isArray(values) || values.length === 0) {
    throw new ToolError("INVALID_TARGET", "CLI context requires at least one supported target.");
  }
  const unique = [...new Set(values)];
  const unsupported = unique.filter((pluginId) => !DREAMSKIN_PLUGIN_IDS.includes(pluginId));
  if (unsupported.length) {
    throw new ToolError("INVALID_TARGET", "CLI context received an unsupported target.", {
      unsupported,
      supported: [...DREAMSKIN_PLUGIN_IDS],
    });
  }
  return unique;
}

async function installCliRuntimes(paths, pluginIds) {
  const packageRoot = path.join(paths.resourceRoot, "build", "cli-runtime");
  const runtimeRoot = path.join(paths.dataRoot, "runtime");
  const roots = {};
  for (const pluginId of pluginIds) {
    const sourceRoot = path.join(packageRoot, pluginId);
    try {
      const installer = new VersionedRuntimeInstaller({
        runtimeRoot,
        namespace: pluginId,
      });
      const installed = await installer.install({ sourceRoot });
      roots[pluginId] = installed.root;
    } catch (error) {
      if (error.code !== "RUNTIME_PACKAGE_MISSING" || paths.packaged) throw error;
      roots[pluginId] = paths.resourceRoot;
    }
  }
  return Object.freeze(roots);
}

export async function createDreamSkinCliContext(options = {}) {
  const paths = resolveDreamSkinCliPaths(options);
  const pluginIds = selectedPluginIds(options.pluginIds);
  const runtimeRoots = await installCliRuntimes(paths, pluginIds);
  process.env.TRAE_DREAM_SKIN_HOME = paths.runtimeStateRoots["dreamskin.trae"];
  const registration = (target, runtimeRoot) => ({
    themesRoot: target.themesRoot,
    dataRoot: target.dataRoot,
    backupsRoot: target.backupsRoot,
    projectRoot: paths.resourceRoot,
    pluginRoot: target.pluginRoot,
    pluginManifestPath: target.pluginManifestPath,
    catalogThemesRoot: target.catalogThemesRoot,
    registryPath: target.registryPath,
    scriptsRoot: path.join(runtimeRoot, "scripts"),
  });
  const targets = [];
  if (pluginIds.includes("dreamskin.trae")) {
    targets.push(await createTraeTargetRegistration(registration(
      paths.targets["dreamskin.trae"],
      runtimeRoots["dreamskin.trae"],
    )));
  }
  if (pluginIds.includes(WORKBUDDY_PLUGIN_ID)) {
    const runtimeRoot = runtimeRoots[WORKBUDDY_PLUGIN_ID];
    targets.push(await createWorkBuddyTargetRegistration({
      ...registration(paths.targets[WORKBUDDY_PLUGIN_ID], runtimeRoot),
      cssPath: path.join(runtimeRoot, "plugins", "workbuddy", "assets", "workbuddy-skin.css"),
      templatePath: path.join(runtimeRoot, "assets", "workbuddy-renderer-inject.js"),
      registryPath: path.join(runtimeRoot, "plugins", "workbuddy", "resources", "components.v1.json"),
      stateRoot: paths.runtimeStateRoots[WORKBUDDY_PLUGIN_ID],
    }));
  }
  const context = await createApplicationContext({
    targets,
    defaultPluginId: pluginIds[0],
    projectRoot: paths.resourceRoot,
    dataRoot: paths.dataRoot,
  });
  return Object.freeze({
    paths,
    runtimeRoots,
    context,
    tool: context.tool,
    runtime: context.runtime,
    targets: () => context.pluginManager.list().map((entry) => ({
      pluginId: entry.id,
      targetId: entry.manifest.target.id,
      name: entry.manifest.target.name,
      version: entry.manifest.version,
      active: entry.active,
      supported: entry.manifest.target.platforms.includes(options.platform || process.platform),
      platforms: [...entry.manifest.target.platforms],
      editions: entry.id === "dreamskin.trae"
        ? ["auto", "international", "cn"]
        : [],
    })),
    async close() {
      const active = context.pluginManager.list({ state: "active" });
      const settled = await Promise.allSettled(active.map((entry) => context.pluginManager.deactivate(entry.id)));
      const failure = settled.find((entry) => entry.status === "rejected");
      if (failure) {
        throw new ToolError("CLI_SHUTDOWN_FAILED", "DreamSkin CLI could not close its plugin context.", undefined, {
          cause: failure.reason,
        });
      }
    },
  });
}
