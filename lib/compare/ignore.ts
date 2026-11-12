import picomatch from "picomatch";

import { CompareError } from "./errors";

export const DEFAULT_IGNORE = ["node_modules", ".git", ".DS_Store"];

const MAX_PATTERNS = 32;
const MAX_PATTERN_LENGTH = 200;
const GLOB_CHARS = /[*?[\]]/;

export type IgnoreRules = {
  patterns: string[];
  match(relativePosixPath: string): boolean;
};

export function compileIgnore(input: string[] | undefined): IgnoreRules {
  const patterns = normalizePatterns(input);
  const compiled = patterns.map(compileOne);
  return {
    patterns,
    match(relativePosixPath: string) {
      if (!relativePosixPath) return false;
      const segments = relativePosixPath.split("/");
      const base = segments[segments.length - 1] ?? relativePosixPath;
      for (const rule of compiled) {
        if (rule(relativePosixPath, segments, base)) return true;
      }
      return false;
    },
  };
}

function normalizePatterns(input: string[] | undefined): string[] {
  if (input === undefined) return [...DEFAULT_IGNORE];
  if (!Array.isArray(input)) {
    throw new CompareError("patterns must be an array of strings");
  }
  if (input.length > MAX_PATTERNS) {
    throw new CompareError(`At most ${MAX_PATTERNS} ignore patterns are allowed`);
  }
  const patterns: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      throw new CompareError("Ignore patterns must be strings");
    }
    const pattern = raw.trim().replace(/^\.\//, "");
    if (!pattern) continue;
    if (pattern.length > MAX_PATTERN_LENGTH || pattern.includes("\0")) {
      throw new CompareError(`Invalid ignore pattern: ${raw.trim().slice(0, 40)}`);
    }
    patterns.push(pattern.replace(/\/+$/, ""));
  }
  return patterns;
}

function assertBalancedBrackets(pattern: string): void {
  let depth = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth < 0) {
        throw new CompareError(`Invalid ignore pattern: ${pattern}`);
      }
    }
  }
  if (depth !== 0) {
    throw new CompareError(`Invalid ignore pattern: ${pattern}`);
  }
}

function compileOne(
  pattern: string,
): (relativePath: string, segments: string[], base: string) => boolean {
  const hasGlob = GLOB_CHARS.test(pattern);
  if (!hasGlob && !pattern.includes("/")) {
    return (_relativePath, segments) => segments.includes(pattern);
  }
  if (!hasGlob) {
    return (relativePath) =>
      relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  }
  assertBalancedBrackets(pattern);
  let matcher: picomatch.Matcher;
  try {
    matcher = picomatch(pattern, { dot: true });
  } catch {
    throw new CompareError(`Invalid ignore pattern: ${pattern}`);
  }
  return (relativePath, _segments, base) => matcher(relativePath) || matcher(base);
}
