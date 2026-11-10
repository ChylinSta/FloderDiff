import { browseDirectory } from "@/lib/compare/browse";
import { errorResponse } from "@/lib/compare/http";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("path");
  try {
    const result = await browseDirectory(target);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
