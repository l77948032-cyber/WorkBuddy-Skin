import path from "node:path";

import { ToolError } from "./errors.mjs";

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveResourcePath(resourceRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")) {
    throw new ToolError("RESOURCE_PATH_INVALID", "Resource paths must be non-empty POSIX relative paths.", {
      path: relativePath,
    });
  }
  if (path.posix.isAbsolute(relativePath)) {
    throw new ToolError("RESOURCE_PATH_INVALID", "Resource paths cannot be absolute.", { path: relativePath });
  }
  const normalized = path.posix.normalize(relativePath);
  const segments = normalized.split("/");
  if (
    normalized === "."
    || normalized !== relativePath
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ToolError("RESOURCE_PATH_INVALID", "Resource paths cannot traverse or normalize outside the package.", {
      path: relativePath,
    });
  }
  const root = path.resolve(resourceRoot);
  const target = path.resolve(root, ...segments);
  if (!isInside(root, target)) {
    throw new ToolError("RESOURCE_PATH_INVALID", "Resource path escapes the package root.", {
      path: relativePath,
    });
  }
  return target;
}
