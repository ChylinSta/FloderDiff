import { lstat } from "node:fs/promises";

import { normalizeUserPath } from "@/lib/compare/paths";
import type { PathDescription, PathKind } from "@/lib/compare/types";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("path") ?? "";
  if (raw.trim() === "") {
    return Response.json({ error: "Provide a path." }, { status: 400 });
  }
  const resolved = normalizeUserPath(raw);
  let description: PathDescription;
  try {
    const info = await lstat(resolved);
    const kind: PathKind = info.isSymbolicLink()
      ? "symlink"
      : info.isDirectory()
        ? "directory"
        : info.isFile()
          ? "file"
          : "other";
    description = { path: resolved, exists: true, kind };
  } catch {
    description = { path: resolved, exists: false, kind: "missing" };
  }
  return Response.json(description, { headers: { "cache-control": "no-store" } });
}
