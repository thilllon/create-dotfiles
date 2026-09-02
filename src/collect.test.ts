import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { list as tarList } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CollectOptions,
  type CollectProgress,
  collect,
  countByGroup,
  writePlan,
} from "./collect";
import { DotfileError } from "./errors";
import { resolveTargets } from "./plan";
import { createFile, FIXED_DATE, FIXED_NAME, makeTempDir } from "./test-helpers";

async function tarEntries(file: string): Promise<string[]> {
  const entries: string[] = [];
  await tarList({ file, onReadEntry: (entry) => entries.push(entry.path) });
  return entries;
}

describe("collect", () => {
  let home: string;
  let out: string;

  beforeEach(() => {
    home = makeTempDir();
    out = join(home, "out");
    createFile(home, ".zshrc", "export ZSH=1");
    createFile(home, ".config/nvim/lua/init.lua", "-- vim");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const run = (options: CollectOptions = {}) =>
    collect({ homeDir: home, outDir: out, now: FIXED_DATE, ...options });

  it("copies files to <out>/dotfiles-<ts>/<home-relative path>", async () => {
    const summary = await run();

    const folder = join(out, FIXED_NAME);
    expect(readFileSync(join(folder, ".zshrc"), "utf8")).toBe("export ZSH=1");
    expect(readFileSync(join(folder, ".config/nvim/lua/init.lua"), "utf8")).toBe("-- vim");
    expect(readdirSync(out)).toEqual([FIXED_NAME]);
    expect(summary.written).toEqual([folder]);
    expect(summary.copied.map((f) => f.path)).toEqual([".zshrc", ".config/nvim/lua/init.lua"]);
    expect(summary.copiedBytes).toBe(12 + 6);
    expect(summary.counts).toEqual({ core: 2, secrets: 0, "config-all": 0, custom: 0 });
    expect(summary.dryRun).toBe(false);
  });

  it("writes a zip whose entries are rooted at dotfiles-<ts>/", async () => {
    const summary = await run({ formats: ["zip"] });

    const zipPath = join(out, `${FIXED_NAME}.zip`);
    expect(summary.written).toEqual([zipPath]);
    const entries = unzipSync(readFileSync(zipPath));
    expect(Object.keys(entries).sort()).toEqual([
      `${FIXED_NAME}/.config/nvim/lua/init.lua`,
      `${FIXED_NAME}/.zshrc`,
    ]);
    expect(strFromU8(entries[`${FIXED_NAME}/.zshrc`])).toBe("export ZSH=1");
    expect(strFromU8(entries[`${FIXED_NAME}/.config/nvim/lua/init.lua`])).toBe("-- vim");
  });

  it("writes a gzip tar with the same layout", async () => {
    const summary = await run({ formats: ["tar"] });

    const tarPath = join(out, `${FIXED_NAME}.tar.gz`);
    expect(summary.written).toEqual([tarPath]);
    const bytes = readFileSync(tarPath);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const entries = await tarEntries(tarPath);
    expect(entries).toContain(`${FIXED_NAME}/.zshrc`);
    expect(entries).toContain(`${FIXED_NAME}/.config/nvim/lua/init.lua`);
    expect(entries.every((e) => e.startsWith(`${FIXED_NAME}/`))).toBe(true);
  });

  it("removes the staging folder when folder is not among the formats", async () => {
    const summary = await run({ formats: ["zip", "tar"] });

    expect(existsSync(join(out, FIXED_NAME))).toBe(false);
    expect(readdirSync(out).sort()).toEqual([`${FIXED_NAME}.tar.gz`, `${FIXED_NAME}.zip`]);
    expect(summary.written).toEqual([
      join(out, `${FIXED_NAME}.zip`),
      join(out, `${FIXED_NAME}.tar.gz`),
    ]);
  });

  it("keeps the folder next to the archives when all three formats are selected", async () => {
    await run({ formats: ["folder", "zip", "tar"] });

    expect(readdirSync(out).sort()).toEqual([
      FIXED_NAME,
      `${FIXED_NAME}.tar.gz`,
      `${FIXED_NAME}.zip`,
    ]);
  });

  it("writes nothing in a dry run but reports what would happen", async () => {
    const summary = await run({ dryRun: true, formats: ["folder", "zip"] });

    expect(existsSync(out)).toBe(false);
    expect(summary.dryRun).toBe(true);
    expect(summary.written).toEqual([]);
    expect(summary.copied.map((f) => f.path)).toEqual([".zshrc", ".config/nvim/lua/init.lua"]);
    expect(summary.outputPaths).toEqual([join(out, FIXED_NAME), join(out, `${FIXED_NAME}.zip`)]);
    expect(summary.counts.core).toBe(2);
  });

  it("skips files over the size cap and lists them", async () => {
    createFile(home, ".bashrc", Buffer.alloc(2 * 1024 * 1024));

    const summary = await run({ maxFileSizeMb: 1 });

    expect(existsSync(join(out, FIXED_NAME, ".bashrc"))).toBe(false);
    expect(summary.tooLarge.map((f) => f.path)).toEqual([".bashrc"]);
    expect(summary.copied.map((f) => f.path)).not.toContain(".bashrc");
  });

  it("counts copied files per group and reports missing targets per group", async () => {
    createFile(home, ".npmrc", "token");
    createFile(home, "projects/.env", "X=1");
    createFile(home, ".config/tool/a.toml", "a");

    const summary = await run({ includeEnv: true, includeConfig: true });

    expect(summary.counts).toEqual({ core: 2, secrets: 2, "config-all": 1, custom: 0 });
    expect(summary.missing).toContainEqual({ path: ".netrc", group: "secrets" });
    expect(summary.missing).toContainEqual({ path: ".bashrc", group: "core" });
  });

  it("stages real content for symlinked dotfiles", async () => {
    createFile(home, "real-vimrc", "set nu");
    symlinkSync(join(home, "real-vimrc"), join(home, ".vimrc"));

    await run();

    const copy = join(out, FIXED_NAME, ".vimrc");
    expect(lstatSync(copy).isSymbolicLink()).toBe(false);
    expect(readFileSync(copy, "utf8")).toBe("set nu");
  });

  it("refuses to write over an existing output", async () => {
    mkdirSync(join(out, FIXED_NAME), { recursive: true });
    await expect(run()).rejects.toThrow(DotfileError);
    await expect(run()).rejects.toThrow(/already exists/);

    createFile(out, `${FIXED_NAME}.zip`, "old");
    await expect(run({ formats: ["zip"] })).rejects.toThrow(/already exists/);
    expect(readFileSync(join(out, `${FIXED_NAME}.zip`), "utf8")).toBe("old");
  });

  it("reports progress after each file", async () => {
    const events: CollectProgress[] = [];

    await run({ onProgress: (p) => events.push(p) });

    expect(events.map((e) => [e.done, e.total, e.file.path])).toEqual([
      [1, 2, ".zshrc"],
      [2, 2, ".config/nvim/lua/init.lua"],
    ]);
  });

  it("records a copy failure and carries on with the remaining files", async () => {
    const plan = resolveTargets({ homeDir: home, outDir: out, now: FIXED_DATE });
    rmSync(join(home, ".zshrc"));

    const summary = await writePlan(plan);

    expect(summary.copied.map((f) => f.path)).toEqual([".config/nvim/lua/init.lua"]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ path: ".zshrc", group: "core" });
    expect(summary.failed[0].error).toMatch(/ENOENT/);
    expect(summary.counts.core).toBe(1);
  });

  it("has flushed and closed both archives by the time it resolves", async () => {
    const stray: unknown[] = [];
    const onUncaught = (err: unknown) => void stray.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const summary = await run({ formats: ["folder", "zip", "tar"] });
      // Pull the staged copies away immediately: a writer still reading them would now fail.
      rmSync(summary.stagingDir, { recursive: true });

      const zipPath = join(out, `${FIXED_NAME}.zip`);
      const tarPath = join(out, `${FIXED_NAME}.tar.gz`);
      expect(summary.written).toEqual([summary.stagingDir, zipPath, tarPath]);
      const entries = unzipSync(readFileSync(zipPath));
      expect(Object.keys(entries).sort()).toEqual([
        `${FIXED_NAME}/.config/nvim/lua/init.lua`,
        `${FIXED_NAME}/.zshrc`,
      ]);
      expect(strFromU8(entries[`${FIXED_NAME}/.config/nvim/lua/init.lua`])).toBe("-- vim");
      expect(await tarEntries(tarPath)).toEqual(
        expect.arrayContaining([`${FIXED_NAME}/.zshrc`, `${FIXED_NAME}/.config/nvim/lua/init.lua`])
      );

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stray).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("reports a staged file that vanished before zipping as a rejection, not a crash", async () => {
    const plan = resolveTargets({ homeDir: home, outDir: out, now: FIXED_DATE, formats: ["zip"] });
    const onProgress = ({ done, total }: CollectProgress) => {
      if (done === total) rmSync(join(plan.stagingDir, ".zshrc"));
    };

    await expect(writePlan(plan, { onProgress })).rejects.toThrow(/ENOENT.*\.zshrc/);

    expect(existsSync(join(out, `${FIXED_NAME}.zip`))).toBe(false);
    expect(existsSync(plan.stagingDir)).toBe(false);
  });

  it("removes the staging folder when the archive cannot be written and stops yazl reading it", async () => {
    const stray: unknown[] = [];
    const onUncaught = (err: unknown) => void stray.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const plan = resolveTargets({
        homeDir: home,
        outDir: out,
        now: FIXED_DATE,
        formats: ["zip"],
      });
      plan.outputs.zip = join(out, "missing-dir", "x.zip");

      await expect(writePlan(plan)).rejects.toThrow(/ENOENT/);

      expect(existsSync(plan.stagingDir)).toBe(false);
      // Before the fix yazl kept pumping entries after the write stream had failed, hit the
      // removed staging folder and emitted an 'error' nobody listened for. Let that surface.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stray).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});

describe("countByGroup", () => {
  it("counts every group, defaulting to zero", () => {
    expect(countByGroup([{ group: "core" }, { group: "core" }, { group: "custom" }])).toEqual({
      core: 2,
      secrets: 0,
      "config-all": 0,
      custom: 1,
    });
  });
});
