import path from "node:path";

export type FixturePaths = {
  leftDir: string;
  rightDir: string;
  leftFile: string;
  rightFile: string;
};

export function fixturePaths(cwd = process.cwd()): FixturePaths {
  return {
    leftDir: path.join(cwd, "fixtures", "left"),
    rightDir: path.join(cwd, "fixtures", "right"),
    leftFile: path.join(cwd, "fixtures", "files", "left.txt"),
    rightFile: path.join(cwd, "fixtures", "files", "right.txt"),
  };
}
