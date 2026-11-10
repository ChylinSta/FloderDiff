import { copyPath, resolveInsideRoot } from "@/lib/compare/copy";
import { errorResponse } from "@/lib/compare/http";

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
  const { from, to, toRoot, relativePath, overwrite } = body as {
    from?: unknown;
    to?: unknown;
    toRoot?: unknown;
    relativePath?: unknown;
    overwrite?: unknown;
  };
  if (typeof from !== "string" || typeof overwrite !== "boolean") {
    return Response.json({ error: "from and overwrite are required." }, { status: 400 });
  }
  try {
    const destination =
      typeof to === "string"
        ? to
        : typeof toRoot === "string" && typeof relativePath === "string"
          ? resolveInsideRoot(toRoot, relativePath)
          : null;
    if (!destination) {
      return Response.json({ error: "Provide a destination path, or a folder and a relative path." }, { status: 400 });
    }
    const result = await copyPath(from, destination, overwrite);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
