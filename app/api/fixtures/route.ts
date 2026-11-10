import { connection } from "next/server";

import { fixturePaths } from "@/lib/compare/fixtures";

export async function GET() {
  await connection();
  return Response.json(fixturePaths(), { headers: { "cache-control": "no-store" } });
}
