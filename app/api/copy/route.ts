import { CompareError, CopyCancelledError, beginCopy, copyPath, isCopyId, resolveInsideRoot } from "@/lib/compare";

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
  const record = body as Record<string, unknown>;
  if (typeof record.from !== "string" || typeof record.overwrite !== "boolean") {
    return Response.json({ error: "from and overwrite are required." }, { status: 400 });
  }
  if (record.copyId !== undefined && (typeof record.copyId !== "string" || !isCopyId(record.copyId))) {
    return Response.json({ error: "copyId is invalid." }, { status: 400 });
  }
  let destination: string;
  try {
    destination =
      typeof record.to === "string"
        ? record.to
        : typeof record.toRoot === "string" && typeof record.relativePath === "string"
          ? resolveInsideRoot(record.toRoot, record.relativePath)
          : "";
  } catch (error) {
    const message = error instanceof CompareError ? error.message : "Could not resolve the destination.";
    const status = error instanceof CompareError ? error.status : 400;
    return Response.json({ error: message }, { status });
  }
  if (!destination) {
    return Response.json({ error: "Provide a destination path, or a folder and a relative path." }, { status: 400 });
  }

  const session = beginCopy(typeof record.copyId === "string" ? record.copyId : undefined, request.signal);
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
        const result = await copyPath(record.from as string, destination, {
          overwrite: record.overwrite === true,
          mirror: record.mirror === true,
          copySymlinks: record.copySymlinks === true,
          sourceRoot: typeof record.sourceRoot === "string" ? record.sourceRoot : undefined,
          destRoot: typeof record.destRoot === "string" ? record.destRoot : undefined,
          signal: session.signal,
          onProgress: async (progress) => {
            const now = Date.now();
            const finished = progress.done === progress.total && progress.total > 0;
            if (!finished && now - lastSent < 80) return;
            lastSent = now;
            send({ type: "progress", ...progress });
            await new Promise((resolve) => setImmediate(resolve));
          },
        });
        send({ type: "result", result });
      } catch (error) {
        if (error instanceof CopyCancelledError) {
          send({
            type: "cancelled",
            error: error.message,
            removed: error.report.removed,
            restored: error.report.restored,
            partial: error.report.partial,
          });
        } else if (request.signal.aborted) {
          return;
        } else {
          const message = error instanceof CompareError ? error.message : "Unexpected error while copying.";
          if (!(error instanceof CompareError)) console.error(error);
          send({ type: "error", error: message });
        }
      } finally {
        session.finish();
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      }
    },
    cancel() {
      session.finish();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
