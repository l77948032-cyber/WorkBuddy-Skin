import path from "node:path";

import { DreamSkinToolCore } from "./dreamskin-tool.mjs";
import { ToolError } from "./errors.mjs";
import { PROJECT_ROOT, TOOL_DATA_ROOT } from "./paths.mjs";
import { PluginManager } from "./plugin-manager.mjs";
import { HostRuntimeManager } from "./runtime-manager.mjs";

export const DEFAULT_PLUGIN_ID = "dreamskin.workbuddy";

function assertTargetRegistration(target, index) {
  if (!target || typeof target !== "object" || Array.isArray(target) || !target.plugin) {
    throw new ToolError(
      "INVALID_APPLICATION_CONTEXT",
      `Application target at index ${index} must provide a plugin.`,
    );
  }
  return target;
}

function targetRecord(target, plugin, resources) {
  return Object.freeze({
    ...target,
    plugin,
    pluginId: plugin.manifest.id,
    targetId: plugin.manifest.target.id,
    targetName: plugin.manifest.target.name,
    rootPath: path.resolve(target.rootPath || plugin.rootPath || process.cwd()),
    resources,
  });
}

/**
 * Build the host-wide managers around one or more already-created target plugins.
 * Target-specific repositories and services intentionally remain plugin-owned.
 */
export async function createApplicationContext({
  targets,
  defaultPluginId,
  dataRoot = TOOL_DATA_ROOT,
  projectRoot = PROJECT_ROOT,
  pluginManager: suppliedPluginManager,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new ToolError("INVALID_APPLICATION_CONTEXT", "createApplicationContext requires at least one target.");
  }

  const registrations = targets.map(assertTargetRegistration);
  const pluginManager = suppliedPluginManager || new PluginManager({
    context: {
      dataRoot: path.resolve(dataRoot),
      projectRoot: path.resolve(projectRoot),
    },
  });
  const registered = [];
  const activated = [];
  try {
    for (const registration of registrations) {
      const rootPath = path.resolve(
        registration.rootPath || registration.plugin.rootPath || process.cwd(),
      );
      const descriptor = await pluginManager.register(registration.plugin, { rootPath });
      registered.push({ registration, descriptor });
    }
    for (const { descriptor } of registered) {
      await pluginManager.activate(descriptor.id);
      activated.push(descriptor.id);
    }
  } catch (error) {
    await Promise.allSettled(activated.map((id) => pluginManager.deactivate(id)));
    throw error;
  }

  const resolvedDefaultPluginId = defaultPluginId
    || (pluginManager.has(DEFAULT_PLUGIN_ID) ? DEFAULT_PLUGIN_ID : registered[0].descriptor.id);
  if (!pluginManager.has(resolvedDefaultPluginId)) {
    await Promise.allSettled(activated.map((id) => pluginManager.deactivate(id)));
    throw new ToolError(
      "PLUGIN_NOT_FOUND",
      `Default plugin '${resolvedDefaultPluginId}' is not registered.`,
      { pluginId: resolvedDefaultPluginId },
    );
  }

  const targetRecords = new Map(registered.map(({ registration, descriptor }) => {
    const plugin = registration.plugin;
    return [descriptor.id, targetRecord(
      registration,
      plugin,
      pluginManager.resources(descriptor.id),
    )];
  }));
  const defaultTarget = targetRecords.get(resolvedDefaultPluginId);
  const tool = new DreamSkinToolCore({ pluginManager, defaultPluginId: resolvedDefaultPluginId });
  const runtime = new HostRuntimeManager({ pluginManager, defaultPluginId: resolvedDefaultPluginId });

  return {
    pluginManager,
    tool,
    runtime,
    defaultPluginId: resolvedDefaultPluginId,
    targets: targetRecords,
    target(pluginId = resolvedDefaultPluginId) {
      const target = targetRecords.get(pluginId);
      if (!target) {
        throw new ToolError("PLUGIN_NOT_FOUND", `Plugin '${pluginId}' is not registered.`, { pluginId });
      }
      return target;
    },
    // Default-target aliases preserve the original application-context contract.
    plugin: defaultTarget.plugin,
    repository: defaultTarget.repository,
    platformRuntime: defaultTarget.platformRuntime,
    targetService: defaultTarget.targetService,
    catalogRepository: defaultTarget.catalogRepository,
  };
}

export class LegacyDreamSkinFacade {
  constructor({ tool, runtime, targetService, pluginId = DEFAULT_PLUGIN_ID }) {
    this.tool = tool;
    this.runtime = runtime;
    this.targetService = targetService;
    this.pluginId = pluginId;
  }

  inspect() {
    return this.tool.inspect(this.pluginId);
  }

  themeList() {
    return this.tool.listThemes(this.pluginId);
  }

  themeRead(id) {
    return this.tool.readTheme(id, this.pluginId);
  }

  themeWrite(input = {}) {
    // Compatibility callers retain image replacement and rollback semantics.
    return this.targetService.themeWrite(input);
  }

  themeValidate(input = {}) {
    return this.tool.validateTheme({
      ...(input.id === undefined ? {} : { themeId: input.id }),
      ...(input.theme === undefined ? {} : { theme: input.theme }),
    }, this.pluginId);
  }

  preview(id, options = {}) {
    return this.runtime.preview({ id, ...options }, this.pluginId);
  }

  apply(id) {
    return this.runtime.apply(id, this.pluginId);
  }

  verify(options = {}) {
    return this.runtime.verify(options, this.pluginId);
  }

  restore() {
    return this.runtime.restore(this.pluginId);
  }
}
