import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }),
}));

import { spawn } from "node:child_process";

import { openInSystem, openerCommand } from "./open";

const cleanup: string[] = [];

afterEach(async () => {
  vi.mocked(spawn).mockClear();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("open in the system app", () => {
  it("keeps the Windows start command as separate arguments", () => {
    const target = "C:\\Users\\me\\My Documents\\notes.txt";
    expect(openerCommand(target, "win32")).toEqual({
      command: "cmd.exe",
      args: ["/c", "start", "", target],
    });
    expect(openerCommand("/tmp/notes.txt", "linux")).toEqual({
      command: "xdg-open",
      args: ["/tmp/notes.txt"],
    });
    expect(openerCommand("/tmp/notes.txt", "darwin")).toEqual({
      command: "open",
      args: ["/tmp/notes.txt"],
    });
  });

  it("spawns cmd.exe with an empty window title and does not split a path that contains spaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "folderdiff-open-"));
    cleanup.push(root);
    const target = path.join(root, "my notes.txt");
    await writeFile(target, "hi\n");
    await openInSystem(target, "win32");
    expect(spawn).toHaveBeenCalledWith("cmd.exe", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  });

  it("does not spawn when the path is missing", async () => {
    await expect(openInSystem(path.join(tmpdir(), "folderdiff-missing-file.txt"), "win32")).rejects.toThrow(/does not exist/);
    expect(spawn).not.toHaveBeenCalled();
  });
});
