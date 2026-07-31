import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(
  process.env.WORKBUDDY_SKIN_PROJECT_ROOT || path.join(here, "..", ".."),
);
export const WORKBUDDY_SKIN_HOME = path.resolve(
  process.env.WORKBUDDY_SKIN_HOME || path.join(os.homedir(), ".workbuddy-skin"),
);
export const THEMES_ROOT = path.resolve(
  process.env.WORKBUDDY_SKIN_THEMES_ROOT || path.join(WORKBUDDY_SKIN_HOME, "themes"),
);
export const TOOL_DATA_ROOT = path.resolve(
  process.env.WORKBUDDY_SKIN_TOOL_HOME || path.join(WORKBUDDY_SKIN_HOME, "data"),
);
export const BACKUPS_ROOT = path.join(TOOL_DATA_ROOT, "backups");
export const SCRIPTS_ROOT = path.join(PROJECT_ROOT, "scripts");

export function runtimeStateRoot(platform = process.platform) {
  if (process.env.WORKBUDDY_DREAM_SKIN_HOME) {
    return path.resolve(process.env.WORKBUDDY_DREAM_SKIN_HOME);
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "WorkBuddyDreamSkin");
  }
  return path.join(os.homedir(), ".local", "state", "WorkBuddyDreamSkin");
}
