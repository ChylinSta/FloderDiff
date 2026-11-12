import { CompareError, compareFolders } from "@/lib/compare";

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
  const { left, right, patterns } = body as { left?: unknown; right?: unknown; patterns?: unknown };
  if (typeof left !== "string" || typeof right !== "string") {
    return Response.json({ error: "left and right must be paths." }, { status: 400 });
  }
  if (patterns !== undefined && !Array.isArray(patterns)) {
    return Response.json({ error: "patterns must be an array of strings." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      };
      try {
        let lastSent = 0;
        const result = await compareFolders(left, right, patterns as string[] | undefined, {
          signal: request.signal,
          onProgress: async (progress) => {
            const now = Date.now();
            const finished = progress.phase === "hash" && progress.done === progress.total;
            if (!finished && now - lastSent < 100) return;
            lastSent = now;
            send({ type: "progress", ...progress });
            await new Promise((resolve) => setImmediate(resolve));
          },
        });
        send({ type: "result", result });
      } catch (error) {
        if (request.signal.aborted) return;
        const message = error instanceof CompareError ? error.message : "Unexpected error while reading the filesystem.";
        const status = error instanceof CompareError ? error.status : 500;
        if (!(error instanceof CompareError)) console.error(error);
        send({ type: "error", error: message, status });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
