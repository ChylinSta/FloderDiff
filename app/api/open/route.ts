import { errorResponse } from "@/lib/compare/http";
import { openInSystem } from "@/lib/compare/open";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Expected a JSON object." }, { status: 400 });
  }
  const { path: target } = body as { path?: unknown };
  if (typeof target !== "string") {
    return Response.json({ error: "path must be a string." }, { status: 400 });
  }
  try {
    await openInSystem(target);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
