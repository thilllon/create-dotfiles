import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { list as tarList } from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { readAesZip } from "./test-aes-zip";
import {
  canSymlink,
  createFile,
  FIXED_DATE,
  FIXED_NAME,
  IS_WINDOWS,
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

    expect(events.map((e) => [e.done, e.total, e.file.path, e.stagingDir])).toEqual([
      [1, 2, ".zshrc", join(out, FIXED_NAME)],
      [2, 2, ".config/nvim/lua/init.lua", join(out, FIXED_NAME)],
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

  it.skipIf(IS_WINDOWS)(
    "names the file that failed and leaves no zip when it fails while an earlier entry is still being written",
    async () => {
      // Incompressible and large, so its writes are still in flight when the next entry cannot
      // be opened: destroying the stream then emits ERR_STREAM_DESTROYED, which must neither
      // replace the real error nor skip the removal. The race depends on timing, hence rounds.
      createFile(home, ".vimrc", randomBytes(3 * 1024 * 1024));
      for (let round = 0; round < 3; round++) {
        rmSync(out, { recursive: true, force: true });
        const plan = resolveTargets({
          homeDir: home,
          outDir: out,
          now: FIXED_DATE,
          platform: TEST_PLATFORM,
          formats: ["zip"],
        });
        const last = plan.files[plan.files.length - 1].path;
        const onProgress = ({ done, total, stagingDir }: CollectProgress) => {
          if (done === total) chmodSync(join(stagingDir, last), 0);
        };

        const failure = writePlan(plan, { onProgress });
        await expect(failure).rejects.toThrow(/EACCES/);
        await expect(failure).rejects.not.toThrow(/ERR_STREAM_DESTROYED/);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(existsSync(join(out, `${FIXED_NAME}.zip`))).toBe(false);
      }
    }
  );

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

describe("collect with an encrypted zip", () => {
  const PASSWORD = "correct horse battery staple";
  let home: string;
  let out: string;

  beforeEach(() => {
    home = makeTempDir();
    out = join(home, "out");
    createFile(home, ".zshrc", "export ZSH=1");
    createFile(home, ".npmrc", "//registry.npmjs.org/:_authToken=npm_secret");
    // Larger than one AES block and one deflate block, so both are exercised past their first.
    createFile(home, ".config/nvim/init.lua", `${"-- vim config line\n".repeat(20_000)}`);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const run = (options: CollectOptions = {}) =>
    collect({ homeDir: home, outDir: out, now: FIXED_DATE, platform: TEST_PLATFORM, ...options });
  const zipPath = () => join(out, `${FIXED_NAME}.zip`);

  it("writes WinZip AES-256 AE-2 entries that decrypt to the collected files", async () => {
    const summary = await run({ formats: ["zip"], encryptZip: true, zipPassword: PASSWORD });

    expect(summary.written).toEqual([zipPath()]);
    expect(summary.encryptZip).toBe(true);
    const entries = readAesZip(readFileSync(zipPath()), PASSWORD);
    expect(entries.map((e) => e.name).sort()).toEqual(
      [".config/nvim/init.lua", ".npmrc", ".zshrc"].map((p) => `${FIXED_NAME}/${p}`)
    );
    for (const entry of entries) {
      expect(entry.strength).toBe(3);
      expect(entry.vendorVersion).toBe(2);
      // AE-2 stores no CRC anywhere, so the zip gives nothing away about the plaintext.
      expect(entry.crc32).toBe(0);
      expect(entry.localCrc32).toBe(0);
      expect(entry.descriptorCrc32 ?? 0).toBe(0);
      expect(
        entry.data.equals(readFileSync(join(home, entry.name.slice(FIXED_NAME.length + 1))))
      ).toBe(true);
    }
    expect(new Set(entries.map((e) => e.salt)).size).toBe(entries.length);
    expect(readdirSync(out)).toEqual([`${FIXED_NAME}.zip`]);
  });

  it("cannot be read with a wrong password, nor by a reader that does not decrypt", async () => {
    await run({ formats: ["zip"], encryptZip: true, zipPassword: PASSWORD });

    const bytes = readFileSync(zipPath());
    // The 2-byte verifier lets 1 wrong password in 65,536 through; the MAC then rejects it.
    expect(() => readAesZip(bytes, "not the right password")).toThrow(
      /wrong password|authentication failed/
    );
    expect(() => unzipSync(bytes)).toThrow();
    expect(bytes.includes("npm_secret")).toBe(false);
  });

  it.skipIf(IS_WINDOWS)("keeps each file's permissions", async () => {
    chmodSync(join(home, ".npmrc"), 0o600);

    await run({ formats: ["zip"], encryptZip: true, zipPassword: PASSWORD });

    const npmrc = readAesZip(readFileSync(zipPath()), PASSWORD).find((e) =>
      e.name.endsWith("/.npmrc")
    );
    expect((npmrc?.mode ?? 0) & 0o777).toBe(0o600);
  });

  it("writes the folder and tar.gz unencrypted next to the encrypted zip", async () => {
    const summary = await run({
      formats: ["folder", "zip", "tar"],
      encryptZip: true,
      zipPassword: PASSWORD,
    });

    expect(summary.written).toHaveLength(3);
    expect(readFileSync(join(out, FIXED_NAME, ".npmrc"), "utf8")).toContain("npm_secret");
    expect(await tarFileEntries(join(out, `${FIXED_NAME}.tar.gz`))).toContain(
      `${FIXED_NAME}/.npmrc`
    );
    expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
  });

  it("reads a deferred password only when the zip is really encrypted", async () => {
    const source = vi.fn(() => PASSWORD);

    await run({ formats: ["zip"], dryRun: true, encryptZip: true, zipPassword: source });
    await run({ formats: ["folder"], zipPassword: source });
    expect(source).not.toHaveBeenCalled();

    rmSync(out, { recursive: true, force: true });
    await run({ formats: ["zip"], encryptZip: true, zipPassword: source });
    expect(source).toHaveBeenCalledOnce();
    expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
  });

  it("takes encrypt_zip from the config file when a zip is written, and ignores it otherwise", async () => {
    const config = parseConfig("[settings]\nencrypt_zip = true", home);

    const folderOnly = await run({ config, formats: ["folder"] });
    expect(folderOnly.encryptZip).toBe(false);

    rmSync(out, { recursive: true, force: true });
    const zipped = await run({ config, formats: ["zip"], zipPassword: PASSWORD });
    expect(zipped.encryptZip).toBe(true);
    expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
  });

  it.each([
    [
      "no password",
      { formats: ["zip"], encryptZip: true },
      "Encrypting the zip needs a password (zipPassword)",
    ],
    [
      "a deferred source with no password",
      { formats: ["zip"], encryptZip: true, zipPassword: () => undefined },
      "Encrypting the zip needs a password (zipPassword)",
    ],
    [
      "a short password",
      { formats: ["zip"], encryptZip: true, zipPassword: "too short" },
      "at least 15 characters (got 9)",
    ],
    [
      "a password for a zip that is not encrypted",
      { formats: ["zip"], zipPassword: PASSWORD },
      "A zip password was given, but the zip is not encrypted",
    ],
    [
      "encryption without a zip",
      { formats: ["folder", "tar"], encryptZip: true, zipPassword: PASSWORD },
      'Encrypting the zip needs "zip" among the output formats (got folder, tar)',
    ],
  ] as [string, CollectOptions, string][])(
    "refuses %s and writes nothing",
    async (_, options, message) => {
      await expect(run(options)).rejects.toThrow(DotfileError);
      await expect(run(options)).rejects.toThrow(message);
      expect(existsSync(out)).toBe(false);
    }
  );

  it("checks a password given as a string even in a dry run", async () => {
    await expect(
      run({ formats: ["zip"], dryRun: true, encryptZip: true, zipPassword: "short" })
    ).rejects.toThrow("at least 15 characters");
    const summary = await run({ formats: ["zip"], dryRun: true, encryptZip: true });
    expect(summary.encryptZip).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  it("removes the partial encrypted zip when a staged file vanished before zipping", async () => {
    const plan = resolveTargets({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
      formats: ["zip"],
      encryptZip: true,
    });
    let staged = "";
    const onProgress = ({ done, total, stagingDir }: CollectProgress) => {
      staged = stagingDir;
      if (done === total) rmSync(join(stagingDir, ".zshrc"));
    };

    await expect(writePlan(plan, { onProgress, zipPassword: PASSWORD })).rejects.toThrow(
      /ENOENT.*\.zshrc/
    );

    // .zshrc is the first entry, so the failure lands while the zip file's open is still
    // pending: the teardown must wait for 'close' before unlinking, or the open re-creates it.
    expect(existsSync(zipPath())).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(zipPath())).toBe(false);
    expect(existsSync(staged)).toBe(false);
  });

  it("names the file that failed and leaves no zip when it fails while an earlier entry is still being encrypted", async () => {
    createFile(home, ".vimrc", randomBytes(3 * 1024 * 1024));
    for (let round = 0; round < 4; round++) {
      rmSync(out, { recursive: true, force: true });
      const plan = resolveTargets({
        homeDir: home,
        outDir: out,
        now: FIXED_DATE,
        platform: TEST_PLATFORM,
        formats: ["zip"],
        encryptZip: true,
      });
      const last = plan.files[plan.files.length - 1].path;
      const onProgress = ({ done, total, stagingDir }: CollectProgress) => {
        if (done === total) rmSync(join(stagingDir, last));
      };

      const failure = writePlan(plan, { onProgress, zipPassword: PASSWORD });
      await expect(failure).rejects.toThrow(/ENOENT/);
      await expect(failure).rejects.not.toThrow(/ERR_STREAM_DESTROYED/);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(zipPath())).toBe(false);
    }
  });

  it("stages an encrypted zip privately, never next to the zip, and removes the copies", async () => {
    let staged = "";
    let outDuringRun: string[] = [];
    let privateMode = 0;
    await run({
      formats: ["zip"],
      encryptZip: true,
      zipPassword: PASSWORD,
      onProgress: ({ stagingDir }) => {
        staged = stagingDir;
        outDuringRun = readdirSync(out);
        privateMode = statSync(dirname(stagingDir)).mode & 0o777;
      },
    });

    expect(relative(out, staged).startsWith("..")).toBe(true);
    expect(staged.startsWith(realpathSync(tmpdir())) || staged.startsWith(tmpdir())).toBe(true);
    expect(outDuringRun).toEqual([]);
    if (!IS_WINDOWS) expect(privateMode).toBe(0o700);
    expect(existsSync(dirname(staged))).toBe(false);
    expect(readdirSync(out)).toEqual([`${FIXED_NAME}.zip`]);
  });

  it("writes a tar next to an encrypted zip from the private staging folder", async () => {
    const summary = await run({ formats: ["zip", "tar"], encryptZip: true, zipPassword: PASSWORD });

    expect(summary.written).toEqual([zipPath(), join(out, `${FIXED_NAME}.tar.gz`)]);
    expect(readdirSync(out).sort()).toEqual([`${FIXED_NAME}.tar.gz`, `${FIXED_NAME}.zip`]);
    expect(await tarFileEntries(join(out, `${FIXED_NAME}.tar.gz`))).toEqual(
      [".config/nvim/init.lua", ".npmrc", ".zshrc"].map((p) => `${FIXED_NAME}/${p}`)
    );
  });

  it("removes the partial encrypted zip when the output cannot be written", async () => {
    const plan = resolveTargets({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
      formats: ["zip"],
      encryptZip: true,
    });
    plan.outputs.zip = join(out, "missing-dir", "x.zip");

    await expect(writePlan(plan, { zipPassword: PASSWORD })).rejects.toThrow(/ENOENT/);

    expect(existsSync(plan.outputs.zip)).toBe(false);
    expect(existsSync(plan.stagingDir)).toBe(false);
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
