import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { POST as cancelCopyRequest } from "@/app/api/copy/cancel/route";
import { POST as copyRequest } from "@/app/api/copy/route";

import { beginCopy, cancelCopy } from "./copy-session";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("copy HTTP cancel", () => {
  it("rolls back through the copy response when the cancel route aborts the session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-route-cancel-"));
    cleanup.push(root);
    const source = path.join(root, "left");
    const destination = path.join(root, "right");
    await mkdir(source);
    await mkdir(destination);
    await writeFile(path.join(destination, "keep.txt"), "keep\n");
    await writeFile(path.join(source, "a.txt"), "new\n");
    await writeFile(path.join(destination, "a.txt"), "old\n");
    for (let index = 0; index < 25; index += 1) {
      await writeFile(path.join(source, `f${index}.txt`), `f${index}\n`);
    }
    const copyId = "route-copy-1234";
    const response = await copyRequest(jsonRequest({
      from: source,
      to: destination,
      overwrite: true,
      copyId,
    }));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing body");
    const decoder = new TextDecoder();
    let buffer = "";
    let cancelled = false;
    const events: Array<{ type?: string; phase?: string; done?: number; error?: string; partial?: string[] }> = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        events.push(JSON.parse(line) as { type?: string; phase?: string; done?: number });
      }
      const wrote = events.some((event) => event.type === "progress" && event.phase === "copy" && (event.done ?? 0) > 0);
      if (wrote && !cancelled) {
        cancelCopy(copyId);
        cancelled = true;
      }
    }
    const report = events.find((event) => event.type === "cancelled");
    expect(report?.error).toMatch(/cancelled/i);
    expect(report?.partial ?? []).toEqual([]);
    expect(await readFile(path.join(destination, "keep.txt"), "utf8")).toBe("keep\n");
    expect(await readFile(path.join(destination, "a.txt"), "utf8")).toBe("old\n");
    await expect(readFile(path.join(destination, "f0.txt"))).rejects.toThrow();
  });

  it("cancel route aborts a live copy id and rejects a bad one", async () => {
    const request = new AbortController();
    const session = beginCopy("route-copy-http", request.signal);
    const response = await cancelCopyRequest(jsonRequest({ copyId: "route-copy-http" }));
    expect(await response.json()).toEqual({ ok: true, cancelled: true });
    expect(session.signal.aborted).toBe(true);
    expect(request.signal.aborted).toBe(false);
    session.finish();

    const missing = await cancelCopyRequest(jsonRequest({ copyId: "missing-copy" }));
    expect(await missing.json()).toEqual({ ok: true, cancelled: false });
    const invalid = await cancelCopyRequest(jsonRequest({ copyId: "no" }));
    expect(invalid.status).toBe(400);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
