import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { CompareError } from "./errors";

export async function openInSystem(input: string): Promise<void> {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError("Choose a path to open.");
  }
  const resolved = path.resolve(input);
  try {
    await lstat(resolved);
  } catch {
    throw new CompareError(`Path does not exist: ${resolved}`, 404);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawnOpener(resolved);
    child.on("error", () => {
      reject(new CompareError("Could not launch the system opener.", 500));
    });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function spawnOpener(target: string) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  }
  if (process.platform === "darwin") {
    return spawn("open", [target], { detached: true, stdio: "ignore" });
  }
  return spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
}
