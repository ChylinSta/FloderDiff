import { errorResponse } from "@/lib/compare/http";
import { diffFiles } from "@/lib/compare/text-diff";

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
  const { left, right } = body as { left?: unknown; right?: unknown };
  if (typeof left !== "string" || typeof right !== "string") {
    return Response.json({ error: "left and right must be file paths." }, { status: 400 });
  }
  try {
    return Response.json(await diffFiles(left, right));
  } catch (error) {
    return errorResponse(error);
  }
}
