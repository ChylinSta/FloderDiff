import { previewCopy, resolveInsideRoot } from "@/lib/compare/copy";
import { errorResponse } from "@/lib/compare/http";

export async function POST(request: Request) {
  const parsed = await readCopyBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    const plan = await previewCopy(parsed.from, parsed.to, parsed.options);
    return Response.json(plan);
  } catch (error) {
    return errorResponse(error);
  }
}

async function readCopyBody(request: Request): Promise<
  | {
      ok: true;
      from: string;
      to: string;
      options: {
        overwrite: boolean;
        mirror: boolean;
        copySymlinks: boolean;
        sourceRoot?: string;
        destRoot?: string;
      };
    }
  | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: Response.json({ error: "Expected a JSON body." }, { status: 400 }) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: Response.json({ error: "Expected a JSON object." }, { status: 400 }) };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.from !== "string" || typeof record.overwrite !== "boolean") {
    return { ok: false, response: Response.json({ error: "from and overwrite are required." }, { status: 400 }) };
  }
  let to: string | null = null;
  try {
    to =
      typeof record.to === "string"
        ? record.to
        : typeof record.toRoot === "string" && typeof record.relativePath === "string"
          ? resolveInsideRoot(record.toRoot, record.relativePath)
          : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the destination.";
    return { ok: false, response: Response.json({ error: message }, { status: 400 }) };
  }
  if (!to) {
    return {
      ok: false,
      response: Response.json({ error: "Provide a destination path, or a folder and a relative path." }, { status: 400 }),
    };
  }
  return {
    ok: true,
    from: record.from,
    to,
    options: {
      overwrite: record.overwrite,
      mirror: record.mirror === true,
      copySymlinks: record.copySymlinks === true,
      sourceRoot: typeof record.sourceRoot === "string" ? record.sourceRoot : undefined,
      destRoot: typeof record.destRoot === "string" ? record.destRoot : undefined,
    },
  };
}
