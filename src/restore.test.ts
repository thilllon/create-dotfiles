import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DotfileError } from "./errors";
import { findLatestCollection, restore } from "./restore";
import { createFile, makeTempDir } from "./test-helpers";

describe("findLatestCollection", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempDir();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("returns the newest collection folder by name, not by mtime, ignoring look-alikes", () => {
    mkdirSync(join(home, "dotfiles-20260101-000000"));
    mkdirSync(join(home, "dotfiles-20260902-110342"));
    mkdirSync(join(home, "dotfiles-20260301-120000"));
    mkdirSync(join(home, "dotfiles-old"));
    writeFileSync(join(home, "dotfiles-20270101-000000"), "a file, not a folder");
    writeFileSync(join(home, "dotfiles-20270101-000000.zip"), "zip");
    // The folder with the newest name is the oldest on disk; a mtime-based pick would get it wrong.
    const old = new Date(2020, 0, 1);
    utimesSync(join(home, "dotfiles-20260902-110342"), old, old);
    utimesSync(join(home, "dotfiles-20260301-120000"), new Date(), new Date());

    expect(findLatestCollection(home)).toBe(join(home, "dotfiles-20260902-110342"));
  });

  it("returns undefined when there is no collection", () => {
    mkdirSync(join(home, "something-else"));

    expect(findLatestCollection(home)).toBeUndefined();
  });
});

describe("restore", () => {
  let home: string;
  const older = "dotfiles-20260101-000000";
  const newest = "dotfiles-20260902-110342";

  beforeEach(() => {
    home = makeTempDir();
    createFile(home, `${older}/.zshrc`, "old zshrc");
    createFile(home, `${newest}/.zshrc`, "new zshrc");
    createFile(home, `${newest}/.config/nvim/lua/init.lua`, "-- vim");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("restores the newest collection by default, preserving nested paths", () => {
    const summary = restore({ homeDir: home });

    expect(summary.source).toBe(join(home, newest));
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("new zshrc");
    expect(readFileSync(join(home, ".config/nvim/lua/init.lua"), "utf8")).toBe("-- vim");
    expect(summary.restored.sort()).toEqual([".config/nvim/lua/init.lua", ".zshrc"]);
    expect(summary.skipped).toEqual([]);
    expect(summary.failed).toEqual([]);
  });

  it("leaves existing files alone by default and reports them as skipped", () => {
    createFile(home, ".zshrc", "mine");

    const summary = restore({ homeDir: home });

    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("mine");
    expect(summary.skipped).toEqual([".zshrc"]);
    expect(summary.restored).toEqual([".config/nvim/lua/init.lua"]);
    expect(summary.force).toBe(false);
  });

  it("overwrites existing files with force", () => {
    createFile(home, ".zshrc", "mine");

    const summary = restore({ homeDir: home, force: true });

    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("new zshrc");
    expect(summary.skipped).toEqual([]);
    expect(summary.restored).toContain(".zshrc");
  });

  it("restores from an explicit absolute source", () => {
    const summary = restore({ homeDir: home, source: join(home, older) });

    expect(summary.source).toBe(join(home, older));
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("old zshrc");
  });

  it("resolves a bare collection name against the home directory", () => {
    const summary = restore({ homeDir: home, source: older });

    expect(summary.source).toBe(join(home, older));
    expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("old zshrc");
  });

  it("expands ~/ in the source", () => {
    expect(restore({ homeDir: home, source: `~/${older}` }).source).toBe(join(home, older));
  });

  it("throws a DotfileError when no collection exists", () => {
    const empty = makeTempDir();
    try {
      expect(() => restore({ homeDir: empty })).toThrow(DotfileError);
      expect(() => restore({ homeDir: empty })).toThrow(/No dotfiles-YYYYMMDD-HHMMSS folder found/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it.each([".zip", ".tar.gz", ".tgz", ".tar"])(
    "rejects a %s archive with an explanation and restores nothing",
    (suffix) => {
      createFile(home, `${newest}${suffix}`, "archive bytes");

      expect(() => restore({ homeDir: home, source: join(home, `${newest}${suffix}`) })).toThrow(
        DotfileError
      );
      expect(() => restore({ homeDir: home, source: join(home, `${newest}${suffix}`) })).toThrow(
        `Restoring from an archive is not supported: ${join(home, `${newest}${suffix}`)}`
      );
      expect(existsSync(join(home, ".zshrc"))).toBe(false);
    }
  );

  it("rejects a missing source and a source that is a plain file", () => {
    createFile(home, "notes.txt", "x");

    expect(() => restore({ homeDir: home, source: join(home, "nope") })).toThrow(
      /Restore source not found/
    );
    expect(() => restore({ homeDir: home, source: join(home, "notes.txt") })).toThrow(
      /must be a directory/
    );
  });

  it.each([
    ["its absolute path", (h: string) => h],
    ["~", () => "~"],
  ])("refuses the home directory itself as the source, given as %s", (_label, source) => {
    expect(() => restore({ homeDir: home, source: source(home) })).toThrow(DotfileError);
    expect(() => restore({ homeDir: home, source: source(home) })).toThrow(
      "Restore source must be a collection folder, not the home directory"
    );
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
  });

  it("records a failure when a destination cannot be written and continues", () => {
    mkdirSync(join(home, ".zshrc"));

    const summary = restore({ homeDir: home, force: true });

    expect(summary.failed).toEqual([{ path: ".zshrc", error: expect.stringMatching(/EISDIR/) }]);
    expect(summary.restored).toEqual([".config/nvim/lua/init.lua"]);
    expect(summary.skipped).toEqual([]);
  });
});
