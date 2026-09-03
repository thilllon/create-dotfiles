import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A fresh temporary directory to stand in for the home directory. The temp root is resolved
 * first: on macOS `os.tmpdir()` is `/var/folders/...`, a symlink to `/private/var/...`, and a
 * path that has been through `realpath` would otherwise never equal one built from `tmpdir()`.
 */
export function makeTempDir(prefix = "dotfiles-test-"): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

/**
 * Every test that plans or collects pins the platform, so the suite asserts the same targets
 * on every host; the dedicated platform tests pass `darwin` / `win32` explicitly.
 */
export const TEST_PLATFORM = "linux";

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

export const IS_WINDOWS = process.platform === "win32";

let symlinkProbe: boolean | undefined;

/**
 * Whether this process may create file symlinks. On Windows that needs Developer Mode or the
 * SeCreateSymbolicLinkPrivilege (administrators have it; the GitHub runners do), so tests
 * that link a *file* run under `it.skipIf(!canSymlink())`. Directory links do not need the
 * probe: {@link symlinkDir} falls back to a junction on Windows.
 */
export function canSymlink(): boolean {
  if (symlinkProbe === undefined) {
    const dir = makeTempDir("dotfiles-symlink-probe-");
    try {
      writeFileSync(join(dir, "target"), "x");
      symlinkSync(join(dir, "target"), join(dir, "link"));
      symlinkProbe = true;
    } catch {
      symlinkProbe = false;
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }
  return symlinkProbe;
}

/**
 * Links a directory. A junction on Windows (no privilege needed; `target` must be absolute,
 * which every caller passes), a plain symlink elsewhere. Both are reported by `lstat` as
 * symbolic links, resolved by `realpath` and not entered by the `.env` scan.
 */
export function symlinkDir(target: string, path: string): void {
  symlinkSync(target, path, IS_WINDOWS ? "junction" : undefined);
}

/** 2026-09-02 11:03:42 local time, i.e. `dotfiles-20260902-110342`. */
export const FIXED_DATE = new Date(2026, 8, 2, 11, 3, 42);
export const FIXED_NAME = "dotfiles-20260902-110342";
