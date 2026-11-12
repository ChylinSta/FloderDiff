import path from "node:path";

const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;
const DRIVE_ONLY = /^[A-Za-z]:$/;
const UNC_PREFIX = /^\\\\[^\\]+\\[^\\]+/;

/** A Windows drive path or UNC path, including `C:` and `C:/...`. */
export function isWindowsAbsolute(input: string): boolean {
  return DRIVE_PREFIX.test(input) || DRIVE_ONLY.test(input) || UNC_PREFIX.test(input);
}

/**
 * Resolve a path typed or pasted by a person.
 * Drive paths use Windows rules (`C:\a` and `C:/a` are the same path) even when
 * this process is not running on Windows, so tests can lock that behavior.
 * Other paths use the host platform.
 */
export function normalizeUserPath(input: string): string {
  const value = stripWrappingQuotes(input.trim());
  if (DRIVE_ONLY.test(value)) return `${value[0]!.toUpperCase()}:\\`;
  if (DRIVE_PREFIX.test(value) || UNC_PREFIX.test(value)) {
    const resolved = path.win32.resolve(value);
    return trimTrailingSeparator(resolved, path.win32.parse(resolved).root);
  }
  const resolved = path.resolve(value);
  return trimTrailingSeparator(resolved, path.parse(resolved).root);
}

export function isFilesystemRoot(target: string): boolean {
  const api = pathApi(target);
  const resolved = api.resolve(target);
  return resolved === api.parse(resolved).root;
}

/** True when `child` is `parent` or a path inside it. */
export function isSameOrInside(parent: string, child: string): boolean {
  const relative = relativePath(parent, child);
  if (relative === null) return false;
  return relative === "" || (!relative.startsWith("..") && !isAbsoluteRelative(parent, child, relative));
}

/** True when `child` is strictly inside `parent`. */
export function isStrictlyInside(parent: string, child: string): boolean {
  const relative = relativePath(parent, child);
  if (relative === null || relative === "") return false;
  return !relative.startsWith("..") && !isAbsoluteRelative(parent, child, relative);
}

function relativePath(parent: string, child: string): string | null {
  const api = sharedApi(parent, child);
  if (!api) return null;
  return api.relative(api.resolve(parent), api.resolve(child));
}

function isAbsoluteRelative(parent: string, child: string, relative: string): boolean {
  const api = sharedApi(parent, child) ?? path;
  return api.isAbsolute(relative);
}

function sharedApi(left: string, right: string): typeof path | typeof path.win32 | null {
  const leftWindows = isWindowsAbsolute(left);
  const rightWindows = isWindowsAbsolute(right);
  if (leftWindows && rightWindows) return path.win32;
  if (leftWindows || rightWindows) return null;
  return path;
}

function pathApi(target: string): typeof path | typeof path.win32 {
  return isWindowsAbsolute(target) ? path.win32 : path;
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) return value.slice(1, -1).trim();
  return value;
}

function trimTrailingSeparator(resolved: string, root: string): string {
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, "");
}
