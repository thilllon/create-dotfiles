import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fresh temporary directory to stand in for the home directory. */
export function makeTempDir(prefix = "dotfiles-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes a file under `root`, creating parent directories; returns the absolute path. */
export function createFile(
  root: string,
  relPath: string,
  content: string | Buffer = "test"
): string {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

/** 2026-09-02 11:03:42 local time, i.e. `dotfiles-20260902-110342`. */
export const FIXED_DATE = new Date(2026, 8, 2, 11, 3, 42);
export const FIXED_NAME = "dotfiles-20260902-110342";
