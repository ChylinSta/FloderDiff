import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";

import { CompareError } from "./errors";
import { normalizeUserPath } from "./paths";

export function openerCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32") return { command: "cmd.exe", args: ["/c", "start", "", target] };
  if (platform === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}

export async function openInSystem(input: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (typeof input !== "string" || input.trim() === "") {
    throw new CompareError("Choose a path to open.");
  }
  const resolved = normalizeUserPath(input);
  try {
    await lstat(resolved);
  } catch {
    throw new CompareError(`Path does not exist: ${resolved}`, 404);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawnOpener(resolved, platform);
    child.on("error", () => {
      reject(new CompareError("Could not launch the system opener.", 500));
    });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function spawnOpener(target: string, platform: NodeJS.Platform) {
  const { command, args } = openerCommand(target, platform);
  return spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: platform === "win32",
  });
}
