import { NextResponse } from "next/server";

import { CompareError } from "./errors";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof CompareError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json(
    { error: "Unexpected error while reading the filesystem." },
    { status: 500 },
  );
}
