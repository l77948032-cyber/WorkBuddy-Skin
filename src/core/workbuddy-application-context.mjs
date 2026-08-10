import path from "node:path";

import {
  createWorkBuddyPlugin,
  loadWorkBuddyPluginManifest,
  WORKBUDDY_PLUGIN_ROOT,
} from "../../plugins/workbuddy/plugin.mjs";
import { createApplicationContext, LegacyDreamSkinFacade } from "./application-context.mjs";
import { ToolError } from "./errors.mjs";
import {
  PROJECT_ROOT,
  THEMES_ROOT,
  TOOL_DATA_ROOT,
} from "./paths.mjs";
import { resolvePluginResources } from "./plugin-api.mjs";
import { WorkBuddySkinService } from "./service.mjs";
import { ThemeRepository } from "./theme-repository.mjs";
import { WorkBuddyPlatformRuntime } from "./workbuddy-platform.mjs";

export const WORKBUDDY_PLUGIN_ID = "dreamskin.workbuddy";

export async function createWorkBuddyTargetRegistration({
  themesRoot = THEMES_ROOT,
  dataRoot = path.join(TOOL_DATA_ROOT, "workbuddy"),
  backupsRoot = path.join(dataRoot, "backups"),
  projectRoot = PROJECT_ROOT,
  pluginRoot = WORKBUDDY_PLUGIN_ROOT,
  pluginManifestPath,
  catalogThemesRoot,
  registryPath,
  runtimeMappingPath,
  schemaPath,
  scriptsRoot = path.join(projectRoot, "scripts"),
  cssPath,
  templatePath,
  stateRoot,
  platform = process.platform,
  catalogRepository,
  repository,
  platformRuntime,
  service,
} = {}) {
  const targetPluginRoot = path.resolve(pluginRoot);
  const manifest = await loadWorkBuddyPluginManifest({
    pluginRoot: targetPluginRoot,
    manifestPath: pluginManifestPath,
  });
  const resources = await resolvePluginResources(manifest, targetPluginRoot);
  const targetRepository = repository || new ThemeRepository({
    themesRoot,
    dataRoot,
    backupsRoot,
    projectRoot: targetPluginRoot,
  });
  const targetRuntime = platformRuntime || new WorkBuddyPlatformRuntime({
    platform,
    themesRoot,
    scriptsRoot,
    cssPath: cssPath || path.join(targetPluginRoot, "assets", "workbuddy-skin.css"),
    templatePath: templatePath || path.join(projectRoot, "assets", "workbuddy-renderer-inject.js"),
    registryPath: registryPath || resources.registryPath,
    stateRoot,
  });
  const resolvedCatalogRoot = catalogThemesRoot || resources.catalogRoot;
  if (!catalogRepository && !resolvedCatalogRoot) {
    throw new ToolError("INVALID_PLUGIN_RESOURCE", "WorkBuddy plugin manifest must declare a catalog root.", {
      pluginId: manifest.id,
      resource: "catalog",
    });
  }
  const targetCatalogRepository = catalogRepository || new ThemeRepository({
    themesRoot: resolvedCatalogRoot,
    dataRoot: path.join(dataRoot, "catalog"),
    backupsRoot: path.join(dataRoot, "catalog-backups"),
    projectRoot: targetPluginRoot,
  });
  const targetService = service || new WorkBuddySkinService({
    repository: targetRepository,
    runtime: targetRuntime,
    dataRoot,
    catalogRepository: targetCatalogRepository,
    registryPath: registryPath || resources.registryPath,
    runtimeMappingPath: runtimeMappingPath || resources.runtimeMappingPath,
    schemaPath: schemaPath || resources.schemaPath,
    target: manifest.target,
    product: "WorkBuddy Skin",
  });
  const plugin = await createWorkBuddyPlugin({
    service: targetService,
    pluginRoot: targetPluginRoot,
    manifestPath: pluginManifestPath,
  });
  return {
    plugin,
    rootPath: plugin.rootPath,
    repository: targetRepository,
    platformRuntime: targetRuntime,
    targetService,
    catalogRepository: targetCatalogRepository,
    themesRoot: path.resolve(themesRoot),
    dataRoot: path.resolve(dataRoot),
    registryPath: registryPath || resources.registryPath,
  };
}

export async function createWorkBuddyApplicationContext(options = {}) {
  const target = await createWorkBuddyTargetRegistration(options);
  const context = await createApplicationContext({
    dataRoot: options.dataRoot || target.dataRoot,
    projectRoot: options.projectRoot || PROJECT_ROOT,
    defaultPluginId: target.plugin.manifest.id,
    targets: [target],
  });
  return {
    ...context,
    legacyService: new LegacyDreamSkinFacade({
      tool: context.tool,
      runtime: context.runtime,
      targetService: target.targetService,
      pluginId: target.plugin.manifest.id,
    }),
  };
}
