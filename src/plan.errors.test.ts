import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTargets, scanEnvFiles } from "./plan";
import { createFile, FIXED_DATE, makeTempDir } from "./test-helpers";
import type { WalkedFile } from "./walk";

/**
 * Windows homes hold entries the process may not read: `NTUSER.DAT` and locked files fail
 * with EBUSY or EPERM on stat, the legacy junctions (`Application Data`, `My Documents`)
 * with EPERM on readdir, and a reparse point may refuse realpath. Those errors cannot be
 * provoked on the Linux box the suite runs on (root reads everything), so the filesystem
 * calls are intercepted for paths named after the failure they simulate.
 */
function errno(code: string, syscall: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated, ${syscall} '${path}'`), { code, syscall });
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const failing = (path: unknown, syscall: string): NodeJS.ErrnoException | undefined => {
    const text = String(path).split("\\").join("/");
    if (syscall === "scandir" && text.endsWith("/locked")) return errno("EPERM", syscall, text);
    if (syscall === "stat" && text.endsWith("/busy/.env")) return errno("EBUSY", syscall, text);
    if (syscall === "realpath" && text.endsWith("/reparse")) return errno("EPERM", syscall, text);
    return undefined;
  };
  return {
    ...actual,
    readdirSync: (path: unknown, options?: unknown) => {
      const err = failing(path, "scandir");
      if (err) throw err;
      return (actual.readdirSync as (p: unknown, o?: unknown) => unknown)(path, options);
    },
    statSync: (path: unknown, options?: unknown) => {
      const err = failing(path, "stat");
      if (err) throw err;
      return (actual.statSync as (p: unknown, o?: unknown) => unknown)(path, options);
    },
    realpathSync: Object.assign(
      (path: unknown, options?: unknown) => {
        const err = failing(path, "realpath");
        if (err) throw err;
        return (actual.realpathSync as (p: unknown, o?: unknown) => unknown)(path, options);
      },
      { native: actual.realpathSync.native }
    ),
  };
});

describe("filesystem errors during the scan and the walk", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempDir();
    createFile(home, "projects/app/.env", "APP=1");
    createFile(home, "locked/.env", "LOCKED=1");
    createFile(home, "locked/deeper/.env", "LOCKED=2");
    createFile(home, "busy/.env", "BUSY=1");
    createFile(home, "busy/.env.local", "BUSY=2");
    createFile(home, "zzz/.env", "LAST=1");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("scanEnvFiles skips an unreadable directory and an unstat-able file, reports both and carries on", () => {
    const found: WalkedFile[] = [];
    const errors: [string, string][] = [];

    expect(() =>
      scanEnvFiles(
        home,
        () => false,
        (file) => found.push(file),
        (rel, err) => errors.push([rel, err.message])
      )
    ).not.toThrow();

    expect(found.map((f) => f.path)).toEqual(["busy/.env.local", "projects/app/.env", "zzz/.env"]);
    expect(errors).toEqual([
      ["busy/.env", expect.stringMatching(/^EBUSY/)],
      ["locked", expect.stringMatching(/^EPERM/)],
    ]);
  });

  it("resolveTargets completes with the failures in the plan, not an exception", () => {
    const plan = resolveTargets({ homeDir: home, now: FIXED_DATE, includeEnv: true });

    expect(plan.files.map((f) => f.path)).toEqual([
      "busy/.env.local",
      "projects/app/.env",
      "zzz/.env",
    ]);
    expect(plan.failed).toEqual([
      { path: "busy/.env", group: "secrets", error: expect.stringMatching(/^EBUSY/) },
      { path: "locked", group: "secrets", error: expect.stringMatching(/^EPERM/) },
    ]);
  });

  it("reports an unreadable home directory once instead of throwing", () => {
    const errors: string[] = [];

    scanEnvFiles(
      join(home, "locked"),
      () => false,
      () => {
        throw new Error("nothing should be found");
      },
      (rel) => errors.push(rel)
    );

    expect(errors).toEqual(["."]);
  });

  it("walk reports a directory whose real path cannot be resolved and keeps the rest", () => {
    createFile(home, ".config/reparse/x.toml", "x");
    createFile(home, ".config/tool/y.toml", "y");

    const plan = resolveTargets({
      homeDir: home,
      now: FIXED_DATE,
      includeEnv: false,
      includeConfig: true,
    });

    expect(plan.files.map((f) => f.path)).toEqual([".config/tool/y.toml"]);
    expect(plan.failed).toEqual([
      { path: ".config/reparse", group: "config-all", error: expect.stringMatching(/^EPERM/) },
    ]);
  });
});
