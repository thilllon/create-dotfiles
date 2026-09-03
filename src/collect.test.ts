import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join, sep } from "node:path";
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
import { parseConfig } from "./config";
import { DotfileError } from "./errors";
import { toPosixPath } from "./paths";
import { resolveTargets } from "./plan";
import {
  canSymlink,
  createFile,
  FIXED_DATE,
  FIXED_NAME,
  makeTempDir,
  TEST_PLATFORM,
} from "./test-helpers";

async function tarEntries(file: string): Promise<{ path: string; type: string }[]> {
  const entries: { path: string; type: string }[] = [];
  await tarList({
    file,
    onReadEntry: (entry) => entries.push({ path: entry.path, type: String(entry.type) }),
  });
  return entries;
}

/** Sorted paths of the regular files in a tar (directory entries left out). */
async function tarFileEntries(file: string): Promise<string[]> {
  return (await tarEntries(file))
    .filter((entry) => entry.type === "File")
    .map((entry) => entry.path)
    .sort();
}

function zipEntries(file: string): string[] {
  return Object.keys(unzipSync(readFileSync(file))).sort();
}

/** Sorted `/`-separated paths of the regular files under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .map((rel) => toPosixPath(rel, sep))
    .sort();
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
    collect({ homeDir: home, outDir: out, now: FIXED_DATE, platform: TEST_PLATFORM, ...options });

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

  it("writes a gzip tar whose file entries are exactly the zip's", async () => {
    const summary = await run({ formats: ["zip", "tar"] });

    const zipPath = join(out, `${FIXED_NAME}.zip`);
    const tarPath = join(out, `${FIXED_NAME}.tar.gz`);
    expect(summary.written).toEqual([zipPath, tarPath]);
    const bytes = readFileSync(tarPath);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const expected = [`${FIXED_NAME}/.config/nvim/lua/init.lua`, `${FIXED_NAME}/.zshrc`];
    expect(await tarFileEntries(tarPath)).toEqual(expected);
    expect(zipEntries(zipPath)).toEqual(expected);
    const all = (await tarEntries(tarPath)).map((entry) => entry.path);
    expect(all.filter((path) => !path.startsWith(`${FIXED_NAME}/`))).toEqual([]);
  });

  it.each([
    ["~", (h: string) => h],
    ["backups/deep/er", (h: string) => join(h, "backups/deep/er")],
  ])(
    "with out=%s the zip and tar hold exactly the folder's files, under relative names",
    async (outDir, expectedDir) => {
      const dir = expectedDir(home);

      const summary = await run({ outDir, formats: ["folder", "zip", "tar"] });

      const folder = join(dir, FIXED_NAME);
      const zipPath = join(dir, `${FIXED_NAME}.zip`);
      const tarPath = join(dir, `${FIXED_NAME}.tar.gz`);
      expect(summary.outDir).toBe(dir);
      expect(summary.written).toEqual([folder, zipPath, tarPath]);
      const staged = filesUnder(folder);
      expect(staged).toEqual([".config/nvim/lua/init.lua", ".zshrc"]);
      const expected = staged.map((rel) => `${FIXED_NAME}/${rel}`);
      expect(zipEntries(zipPath)).toEqual(expected);
      expect(await tarFileEntries(tarPath)).toEqual(expected);
      const every = [...zipEntries(zipPath), ...(await tarEntries(tarPath)).map((e) => e.path)];
      expect(every.filter((name) => name.startsWith("/") || name.includes(".."))).toEqual([]);
    }
  );

  it("writes / entry names in zip and tar for an include spelled with backslashes", async () => {
    createFile(home, "work/scripts/run.sh", "#!/bin/sh");
    const config = parseConfig('[files]\ninclude = ["work\\\\scripts"]', home);

    const summary = await run({ config, formats: ["folder", "zip", "tar"] });

    expect(summary.copied.map((f) => f.path)).toContain("work/scripts/run.sh");
    expect(filesUnder(join(out, FIXED_NAME))).toContain("work/scripts/run.sh");
    expect(zipEntries(join(out, `${FIXED_NAME}.zip`))).toContain(
      `${FIXED_NAME}/work/scripts/run.sh`
    );
    expect(await tarFileEntries(join(out, `${FIXED_NAME}.tar.gz`))).toContain(
      `${FIXED_NAME}/work/scripts/run.sh`
    );
    const every = [
      ...zipEntries(join(out, `${FIXED_NAME}.zip`)),
      ...(await tarEntries(join(out, `${FIXED_NAME}.tar.gz`))).map((e) => e.path),
    ];
    expect(every.filter((name) => name.includes("\\"))).toEqual([]);
  });

  it("zips an include spelled with .. under its clean name instead of failing", async () => {
    createFile(home, "notes/todo.md", "todo");
    const config = parseConfig('[files]\ninclude = ["x/../notes/", "./notes/todo.md"]', home);

    const summary = await run({ config, formats: ["zip", "tar"] });

    expect(summary.copied.map((f) => f.path)).toContain("notes/todo.md");
    expect(zipEntries(join(out, `${FIXED_NAME}.zip`))).toContain(`${FIXED_NAME}/notes/todo.md`);
    expect(await tarFileEntries(join(out, `${FIXED_NAME}.tar.gz`))).toContain(
      `${FIXED_NAME}/notes/todo.md`
    );
    expect(summary.failed).toEqual([]);
  });

  it("keeps spaces and non-ASCII characters in paths through folder, zip and tar", async () => {
    const rel = "spaces dir/ünï cödé.txt";
    createFile(home, rel, "ü");
    const config = parseConfig(`[files]\ninclude = ["${rel}"]`, home);

    const summary = await run({ config, formats: ["folder", "zip", "tar"] });

    expect(summary.copied.map((f) => f.path)).toContain(rel);
    expect(readFileSync(join(out, FIXED_NAME, rel), "utf8")).toBe("ü");
    const entries = unzipSync(readFileSync(join(out, `${FIXED_NAME}.zip`)));
    expect(strFromU8(entries[`${FIXED_NAME}/${rel}`])).toBe("ü");
    expect(await tarFileEntries(join(out, `${FIXED_NAME}.tar.gz`))).toContain(
      `${FIXED_NAME}/${rel}`
    );
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

  it.skipIf(!canSymlink())("stages real content for symlinked dotfiles", async () => {
    createFile(home, "real-vimrc", "set nu");
    symlinkSync(join(home, "real-vimrc"), join(home, ".vimrc"));

    await run();

    const copy = join(out, FIXED_NAME, ".vimrc");
    expect(lstatSync(copy).isSymbolicLink()).toBe(false);
    expect(readFileSync(copy, "utf8")).toBe("set nu");
  });

  it("refuses to write over an existing output, names it, and writes nothing else", async () => {
    const folder = join(out, FIXED_NAME);
    mkdirSync(folder, { recursive: true });
    await expect(run()).rejects.toThrow(DotfileError);
    await expect(run()).rejects.toThrow(`Output already exists: ${folder}`);
    expect(readdirSync(folder)).toEqual([]);
    rmSync(folder, { recursive: true });

    const zipPath = join(out, `${FIXED_NAME}.zip`);
    createFile(out, `${FIXED_NAME}.zip`, "old");
    await expect(run({ formats: ["zip", "tar"] })).rejects.toThrow(
      `Output already exists: ${zipPath}`
    );
    expect(readFileSync(zipPath, "utf8")).toBe("old");
    // Neither the staging folder nor the tar was started.
    expect(readdirSync(out)).toEqual([`${FIXED_NAME}.zip`]);
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
    const plan = resolveTargets({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
    });
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
      const expected = [`${FIXED_NAME}/.config/nvim/lua/init.lua`, `${FIXED_NAME}/.zshrc`];
      const entries = unzipSync(readFileSync(zipPath));
      expect(Object.keys(entries).sort()).toEqual(expected);
      expect(strFromU8(entries[`${FIXED_NAME}/.config/nvim/lua/init.lua`])).toBe("-- vim");
      expect(await tarFileEntries(tarPath)).toEqual(expected);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stray).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });

  it("reports a staged file that vanished before zipping as a rejection, not a crash", async () => {
    const plan = resolveTargets({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
      formats: ["zip"],
    });
    const onProgress = ({ done, total }: CollectProgress) => {
      if (done === total) rmSync(join(plan.stagingDir, ".zshrc"));
    };

    await expect(writePlan(plan, { onProgress })).rejects.toThrow(/ENOENT.*\.zshrc/);

    expect(existsSync(join(out, `${FIXED_NAME}.zip`))).toBe(false);
    expect(existsSync(plan.stagingDir)).toBe(false);
  });

  it("removes the partial zip even when the failure lands before the file has been opened", async () => {
    const plan = resolveTargets({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
      formats: ["zip"],
    });
    // yazl rejects a `..` segment in an entry name synchronously, so the rejection arrives while
    // createWriteStream's open is still pending. The teardown must wait for the stream to close
    // before unlinking, or the pending open re-creates an empty archive after the unlink.
    plan.files[0] = { ...plan.files[0], path: `.config/../${plan.files[0].path}` };
    const zipPath = join(out, `${FIXED_NAME}.zip`);

    await expect(writePlan(plan)).rejects.toThrow(/invalid relative path/);

    expect(existsSync(zipPath)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(zipPath)).toBe(false);
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
        platform: TEST_PLATFORM,
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
