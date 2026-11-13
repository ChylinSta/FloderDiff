import { describe, expect, it } from "vitest";

import { platformRoots } from "./browse";

describe("drive letter browse", () => {
  it("lists every drive the host reports, from A: through Z:", () => {
    const present = new Set(["C:\\", "C:/", "D:\\"]);
    expect(platformRoots({ platform: "win32", exists: (candidate) => present.has(candidate) })).toEqual([
      "C:\\",
      "D:\\",
    ]);
  });

  it("falls back to C:\\ when no drive can be seen", () => {
    expect(platformRoots({ platform: "win32", exists: () => false })).toEqual(["C:\\"]);
  });

  it("uses the filesystem root off Windows", () => {
    expect(platformRoots({ platform: "linux", exists: () => true })).toEqual(["/"]);
  });
});
