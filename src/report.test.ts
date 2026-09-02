import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collect } from "./collect";
import { parseConfig } from "./config";
import {
  formatBytes,
  formatFoundTargets,
  formatNeverCopied,
  formatRestoreSummary,
  formatSummary,
} from "./report";
import { createFile, FIXED_DATE, FIXED_NAME, makeTempDir } from "./test-helpers";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024 * 1024, "10.0 MB"],
    [3 * 1024 ** 3, "3.0 GB"],
    [2 * 1024 ** 4, "2.0 TB"],
    [5000 * 1024 ** 4, "5000.0 TB"],
  ])("formats %d bytes as %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("formatSummary", () => {
  let home: string;
  let out: string;

  beforeEach(() => {
    home = makeTempDir();
    out = join(home, "out");
    createFile(home, ".zshrc", "12345");
    createFile(home, ".npmrc", "tok");
    createFile(home, "big.bin", Buffer.alloc(1024 * 1024 + 1));
    createFile(home, ".dotfilesrc.toml", '[files]\ninclude = ["big.bin", "absent.txt"]');
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("lists every file with size and group, the skipped, missing and failed entries and the outputs of a dry run", async () => {
    const summary = await collect({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      includeEnv: true,
      maxFileSizeMb: 1,
      formats: ["folder", "zip", "tar"],
      dryRun: true,
    });

    const text = formatSummary(summary);

    expect(text).toContain(`Would copy 2 files (8 B) from ${home}`);
    expect(text).toContain("  .zshrc (5 B) [core]");
    expect(text).toContain("  .npmrc (3 B) [secrets]");
    expect(text).toContain("Per group: core 1, custom 0, secrets 1, config-all 0");
    expect(text).toContain("Skipped, larger than 1 MB (1):\n  big.bin (1.0 MB)");
    expect(text).toMatch(/Not found \(\d+\): .*\.bashrc.*absent\.txt/);
    expect(text).not.toContain("Failed");
    expect(text).toContain(`Would write:\n  folder: ${join(out, FIXED_NAME)}/`);
    expect(text).toContain(`  zip:    ${join(out, `${FIXED_NAME}.zip`)}`);
    expect(text).toContain(`  tar.gz: ${join(out, `${FIXED_NAME}.tar.gz`)}`);
    expect(text.trimEnd().endsWith("Dry run: nothing was written.")).toBe(true);
  });

  it("shows counts only for a real run unless the file list is requested", async () => {
    const summary = await collect({
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      maxFileSizeMb: 1,
    });

    const brief = formatSummary(summary);
    expect(brief).toContain(`Copied 1 file (5 B) from ${home}`);
    expect(brief).not.toContain("[core]");
    expect(brief).toContain(`Written:\n  folder: ${join(out, FIXED_NAME)}/`);
    expect(brief).not.toContain("Dry run");

    const full = formatSummary(summary, { listFiles: true });
    expect(full).toContain("  .zshrc (5 B) [core]");
  });

  it("lists failed entries with their reason", async () => {
    const config = parseConfig('[files]\ninclude = ["dotfiles-20260101-000000"]', home);
    createFile(home, "dotfiles-20260101-000000/x", "x");

    const summary = await collect({ homeDir: home, outDir: out, now: FIXED_DATE, config });

    expect(formatSummary(summary)).toContain(
      "Failed (1):\n  dotfiles-20260101-000000: excluded: matches a never-copied rule"
    );
  });
});

describe("formatRestoreSummary", () => {
  it("prints [OK], [SKIP] and [FAIL] lines and the totals", () => {
    const text = formatRestoreSummary({
      source: "/h/dotfiles-20260902-110342",
      homeDir: "/h",
      force: false,
      restored: [".vimrc"],
      skipped: [".zshrc"],
      failed: [{ path: ".bashrc", error: "EISDIR" }],
    });

    expect(text.split("\n")).toEqual([
      "Restoring /h/dotfiles-20260902-110342 into /h",
      "  [OK] .vimrc",
      "  [SKIP] .zshrc exists (use --force)",
      "  [FAIL] .bashrc: EISDIR",
      "Restored 1 file, 1 skipped, 1 failed.",
    ]);
  });
});

describe("formatFoundTargets", () => {
  it("groups targets by category in first-seen order", () => {
    const text = formatFoundTargets([
      { path: ".zshrc", group: "core", category: "Shell" },
      { path: ".gitconfig", group: "core", category: "Git" },
      { path: ".bashrc", group: "core", category: "Shell" },
      { path: "notes", group: "custom", category: "From ~/.dotfilesrc.toml" },
    ]);

    expect(text).toBe("Shell: .zshrc, .bashrc\nGit: .gitconfig\nFrom ~/.dotfilesrc.toml: notes");
  });

  it("says so when nothing was found", () => {
    expect(formatFoundTargets([])).toMatch(/No dotfiles .* found/);
  });
});

describe("formatNeverCopied", () => {
  it("names the excluded directories, caches, private keys and the size cap", () => {
    const text = formatNeverCopied(10);

    expect(text).toContain("node_modules");
    expect(text).toContain(".git");
    expect(text).toContain("Caches");
    expect(text).toContain("SSH private keys");
    expect(text).toContain("GPG private keys");
    expect(text).toContain("private-keys-v1.d");
    expect(text).toContain("larger than 10 MB");
    expect(text).toContain("4 levels deep");
    expect(text).toContain(
      "never enters ~/Library, ~/Desktop, ~/Documents, ~/Downloads, ~/Movies, ~/Music, ~/Pictures, ~/Public"
    );
    expect(formatNeverCopied(25)).toContain("larger than 25 MB");
  });
});
