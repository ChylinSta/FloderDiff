import path from "node:path";
import { describe, expect, it } from "vitest";

import { isWindowsAbsolute, normalizeUserPath } from "./paths";

describe("pasted paths", () => {
  it("normalizes Windows drive paths with either slash", () => {
    expect(normalizeUserPath("C:\\Users\\me\\compare\\left")).toBe("C:\\Users\\me\\compare\\left");
    expect(normalizeUserPath("C:/Users/me/compare/left")).toBe("C:\\Users\\me\\compare\\left");
    expect(normalizeUserPath("D:\\data")).toBe("D:\\data");
    expect(normalizeUserPath("D:\\data\\")).toBe("D:\\data");
    expect(normalizeUserPath("  C:/Users/me/compare/left  ")).toBe("C:\\Users\\me\\compare\\left");
  });

  it("strips quotes Windows adds when a path is copied", () => {
    expect(normalizeUserPath('"C:\\Users\\me\\compare\\left"')).toBe("C:\\Users\\me\\compare\\left");
    expect(normalizeUserPath("'C:/Users/me/compare/left'")).toBe("C:\\Users\\me\\compare\\left");
    expect(normalizeUserPath('"C:\\Users\\me\\My Documents\\left"')).toBe("C:\\Users\\me\\My Documents\\left");
  });

  it("treats a bare drive letter as that drive root", () => {
    expect(normalizeUserPath("C:")).toBe("C:\\");
    expect(normalizeUserPath("d:/")).toBe("d:\\");
    expect(isWindowsAbsolute("C:\\Users\\me\\compare\\left")).toBe(true);
    expect(isWindowsAbsolute("C:/Users/me/compare/left")).toBe(true);
    expect(isWindowsAbsolute("D:\\data")).toBe(true);
  });

  it("still resolves a host path, including one wrapped in quotes", () => {
    const absolute = path.resolve("fixtures/left");
    expect(normalizeUserPath("fixtures/left")).toBe(absolute);
    expect(normalizeUserPath(`"${absolute}"`)).toBe(absolute);
    expect(isWindowsAbsolute(absolute)).toBe(false);
  });
});
