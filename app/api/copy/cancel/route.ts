import { cancelCopy, isCopyId } from "@/lib/compare";

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
  const copyId = (body as { copyId?: unknown }).copyId;
  if (typeof copyId !== "string" || !isCopyId(copyId)) {
    return Response.json({ error: "copyId is required." }, { status: 400 });
  }
  return Response.json(
    { ok: true, cancelled: cancelCopy(copyId) },
    { headers: { "cache-control": "no-store" } },
  );
}
