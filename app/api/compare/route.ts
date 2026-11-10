import { errorResponse } from "@/lib/compare/http";
import { compareFolders } from "@/lib/compare/folder";

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const { left, right, patterns } = body.value;
  if (typeof left !== "string" || typeof right !== "string") {
    return Response.json({ error: "left and right must be paths." }, { status: 400 });
  }
  if (patterns !== undefined && !Array.isArray(patterns)) {
    return Response.json({ error: "patterns must be an array of strings." }, { status: 400 });
  }
  try {
    const result = await compareFolders(left, right, patterns as string[] | undefined);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: Response.json({ error: "Expected a JSON object." }, { status: 400 }) };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: Response.json({ error: "Expected a JSON body." }, { status: 400 }) };
  }
}
