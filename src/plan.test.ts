import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DotfilesConfig, parseConfig } from "./config";
import { DotfileError } from "./errors";
import type { PlanOptions } from "./options";
import {
  CUSTOM_CATEGORY,
  collectionName,
  ENV_SCAN_TARGET,
  filterPlan,
  type Plan,
  resolveTargets,
} from "./plan";
import { createFile, FIXED_DATE, FIXED_NAME, makeTempDir } from "./test-helpers";

describe("collectionName", () => {
  it("formats local time as dotfiles-YYYYMMDD-HHMMSS", () => {
    expect(collectionName(FIXED_DATE)).toBe(FIXED_NAME);
  });

  it("zero-pads every component", () => {
    expect(collectionName(new Date(2026, 0, 5, 3, 4, 5))).toBe("dotfiles-20260105-030405");
  });
});

describe("resolveTargets", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempDir();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const plan = (options: PlanOptions = {}): Plan =>
    resolveTargets({ homeDir: home, now: FIXED_DATE, ...options });
  const paths = (p: Plan) => p.files.map((f) => f.path);
  const config = (toml: string): DotfilesConfig => parseConfig(toml, home);

  describe("core targets", () => {
    it("plans the targets that exist and reports the others as missing", () => {
      createFile(home, ".zshrc");
      createFile(home, ".config/nvim/init.lua");

      const p = plan();

      expect(paths(p)).toEqual([".zshrc", ".config/nvim/init.lua"]);
      expect(p.found.map((f) => f.path)).toEqual([".zshrc", ".config/nvim"]);
      expect(p.missing.map((m) => m.path)).toContain(".bashrc");
      expect(p.missing.map((m) => m.path)).not.toContain(".zshrc");
      expect(p.missing.every((m) => m.group === "core")).toBe(true);
    });

    it("finds VS Code and Cursor settings at both the macOS and Linux paths", () => {
      createFile(home, "Library/Application Support/Code/User/settings.json", "{}");
      createFile(home, "Library/Application Support/Code/User/snippets/ts.json", "{}");
      createFile(home, ".config/Code/User/keybindings.json", "[]");
      createFile(home, ".config/Cursor/User/settings.json", "{}");

      expect(paths(plan())).toEqual([
        "Library/Application Support/Code/User/settings.json",
        "Library/Application Support/Code/User/snippets/ts.json",
        ".config/Code/User/keybindings.json",
        ".config/Cursor/User/settings.json",
      ]);
    });

    it("records the group, size and originating target of every file", () => {
      createFile(home, ".config/nvim/lua/init.lua", "12345");

      expect(plan().files).toEqual([
        { path: ".config/nvim/lua/init.lua", size: 5, group: "core", target: ".config/nvim" },
      ]);
    });

    it("does not report secrets or ~/.config as missing when they are not requested", () => {
      const p = plan();

      expect(p.missing.map((m) => m.path)).not.toContain(".npmrc");
      expect(p.missing.map((m) => m.path)).not.toContain(".config");
    });
  });

  describe("naming and outputs", () => {
    it("derives the folder, zip and tar paths from outDir, formats and the timestamp", () => {
      const outDir = join(home, "out");

      const p = plan({ outDir, formats: ["folder", "zip", "tar"] });

      expect(p.name).toBe(FIXED_NAME);
      expect(p.stagingDir).toBe(join(outDir, FIXED_NAME));
      expect(p.outputs).toEqual({
        folder: join(outDir, FIXED_NAME),
        zip: join(outDir, `${FIXED_NAME}.zip`),
        tar: join(outDir, `${FIXED_NAME}.tar.gz`),
      });
      expect(p.outputPaths).toEqual([p.outputs.folder, p.outputs.zip, p.outputs.tar]);
    });

    it("omits unselected outputs but still stages into the folder", () => {
      const p = plan({ formats: ["zip"] });

      expect(p.outputs).toEqual({ zip: join(home, `${FIXED_NAME}.zip`) });
      expect(p.outputPaths).toEqual([join(home, `${FIXED_NAME}.zip`)]);
      expect(p.stagingDir).toBe(join(home, FIXED_NAME));
    });

    it("defaults to a folder in the home directory, no opt-in groups and a 10 MB cap", () => {
      const p = resolveTargets({ homeDir: home });

      expect(p.name).toMatch(/^dotfiles-\d{8}-\d{6}$/);
      expect(p.formats).toEqual(["folder"]);
      expect(p.outDir).toBe(home);
      expect(p.includeEnv).toBe(false);
      expect(p.includeConfig).toBe(false);
      expect(p.maxFileSizeMb).toBe(10);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects a size cap of %s with a DotfileError quoting the value",
      (cap) => {
        expect(() => plan({ maxFileSizeMb: cap })).toThrow(DotfileError);
        expect(() => plan({ maxFileSizeMb: cap })).toThrow(`Invalid max file size "${cap}"`);
      }
    );

    it("rejects an unknown format with a DotfileError quoting the value", () => {
      expect(() => plan({ formats: ["rar" as "zip"] })).toThrow(DotfileError);
      expect(() => plan({ formats: ["rar" as "zip"] })).toThrow('Unknown output format "rar"');
    });
  });

  describe("hard excludes", () => {
    it("skips excluded directory names at any depth inside a target", () => {
      createFile(home, ".config/nvim/init.lua");
      createFile(home, ".config/nvim/node_modules/x.js");
      createFile(home, ".config/nvim/plugged/foo/.git/HEAD");
      createFile(home, ".config/nvim/.DS_Store");
      createFile(home, ".config/nvim/lua/.cache/x");

      expect(paths(plan())).toEqual([".config/nvim/init.lua"]);
    });

    it("skips ~/Library caches even inside an explicit include", () => {
      createFile(home, "Library/Caches/com.example/x");
      createFile(home, "Library/Application Support/Code/Cache/blob");
      createFile(home, "Library/Application Support/Code/CachedData/blob");
      createFile(home, "Library/Application Support/Code/User/settings.json", "{}");
      createFile(home, "Library/Preferences/x.plist", "plist");

      const p = plan({ config: config('[files]\ninclude = ["Library"]') });

      expect(paths(p)).toEqual([
        "Library/Application Support/Code/User/settings.json",
        "Library/Preferences/x.plist",
      ]);
    });

    it("never plans SSH private keys, even with secrets opted in and ~/.ssh included", () => {
      createFile(home, ".ssh/config", "Host x");
      createFile(home, ".ssh/id_ed25519", "PRIVATE");
      createFile(home, ".ssh/id_ed25519.pub", "PUBLIC");
      createFile(home, ".ssh/known_hosts", "hosts");
      createFile(home, ".ssh/authorized_keys", "keys");

      const p = plan({ includeEnv: true, config: config('[files]\ninclude = [".ssh"]') });

      expect(paths(p).sort()).toEqual([".ssh/config", ".ssh/id_ed25519.pub"]);
    });

    it("never plans GPG private material, even with ~/.gnupg included", () => {
      createFile(home, ".gnupg/gpg.conf");
      createFile(home, ".gnupg/gpg-agent.conf");
      createFile(home, ".gnupg/private-keys-v1.d/ABC.key", "PRIVATE");
      createFile(home, ".gnupg/pubring.kbx", "kbx");
      createFile(home, ".gnupg/trustdb.gpg", "gpg");

      const p = plan({ includeEnv: true, config: config('[files]\ninclude = [".gnupg"]') });

      expect(paths(p).sort()).toEqual([".gnupg/gpg-agent.conf", ".gnupg/gpg.conf"]);
    });

    it("reports an include entry that hits a never-copied rule instead of ignoring it", () => {
      createFile(home, "dotfiles-20260101-000000/.zshrc");

      const p = plan({ config: config('[files]\ninclude = ["dotfiles-20260101-000000"]') });

      expect(paths(p)).toEqual([]);
      expect(p.failed).toEqual([
        {
          path: "dotfiles-20260101-000000",
          group: "custom",
          error: "excluded: matches a never-copied rule",
        },
      ]);
    });
  });

  describe("secrets group", () => {
    beforeEach(() => {
      createFile(home, ".npmrc", "//registry/:_authToken=x");
      createFile(home, ".env", "ROOT=1");
      createFile(home, "projects/app/.env.local", "APP=1");
      createFile(home, "a/b/c/.env", "DEPTH4=1");
      createFile(home, "a/b/c/d/.env", "DEPTH5=1");
      createFile(home, "projects/app/node_modules/pkg/.env", "NOPE=1");
      createFile(home, "projects/app/.cache/.env", "NOPE=1");
      createFile(home, "projects/app/src/index.ts", "not env");
    });

    it("is off by default", () => {
      const p = plan();

      expect(paths(p)).toEqual([]);
      expect(p.files.some((f) => f.group === "secrets")).toBe(false);
    });

    it("includes credential files and every .env file within four levels", () => {
      const p = plan({ includeEnv: true });

      expect(paths(p)).toEqual([".npmrc", ".env", "a/b/c/.env", "projects/app/.env.local"]);
      expect(p.files.every((f) => f.group === "secrets")).toBe(true);
      expect(p.files.find((f) => f.path === ".npmrc")?.target).toBe(".npmrc");
      expect(p.files.find((f) => f.path === ".env")?.target).toBe(ENV_SCAN_TARGET);
      expect(p.missing.map((m) => m.path)).toContain(".netrc");
    });

    it("never enters the top-level macOS user folders during the scan, only nested namesakes", () => {
      const skipped = [
        "Library",
        "Desktop",
        "Documents",
        "Downloads",
        "Movies",
        "Music",
        "Pictures",
        "Public",
      ];
      for (const folder of skipped) {
        createFile(home, `${folder}/.env`, "TOP=1");
        createFile(home, `${folder}/proj/.env`, "NESTED=1");
      }
      createFile(home, "Library/Application Support/Code/User/settings.json", "{}");
      createFile(home, "projects/proj/.env", "PROJ=1");
      createFile(home, "work/Documents/.env", "DOCS=1");
      createFile(home, "work/Library/.env", "LIB=1");

      const found = paths(plan({ includeEnv: true }));

      const inSkippedFolders = found.filter((path) =>
        skipped.some((folder) => path.startsWith(`${folder}/`) && path.endsWith(".env"))
      );
      expect(inSkippedFolders).toEqual([]);
      expect(found).toEqual(
        expect.arrayContaining(["projects/proj/.env", "work/Documents/.env", "work/Library/.env"])
      );
      // Core targets under ~/Library come from the target walk, which the skip does not touch.
      expect(found).toContain("Library/Application Support/Code/User/settings.json");
    });

    it("does not descend into excluded directories during the scan", () => {
      const found = paths(plan({ includeEnv: true }));

      expect(found).not.toContain("projects/app/node_modules/pkg/.env");
      expect(found).not.toContain("projects/app/.cache/.env");
    });

    it("stops at depth four", () => {
      const found = paths(plan({ includeEnv: true }));

      expect(found).toContain("a/b/c/.env");
      expect(found).not.toContain("a/b/c/d/.env");
    });

    it("does not follow symlinked directories during the scan", () => {
      createFile(home, "real/.env", "REAL=1");
      symlinkSync(join(home, "real"), join(home, "linked"));

      const found = paths(plan({ includeEnv: true }));

      expect(found).toContain("real/.env");
      expect(found).not.toContain("linked/.env");
    });

    it("follows a symlinked .env file", () => {
      createFile(home, "targets/env.txt", "LINKED=1");
      symlinkSync(join(home, "targets/env.txt"), join(home, "projects/.env"));

      expect(plan({ includeEnv: true }).files).toContainEqual({
        path: "projects/.env",
        size: 8,
        group: "secrets",
        target: ENV_SCAN_TARGET,
      });
    });

    it("treats a .env inside a core target as a secret", () => {
      createFile(home, ".config/nvim/.env", "NVIM=1");
      createFile(home, ".config/nvim/init.lua");

      expect(paths(plan())).toEqual([".config/nvim/init.lua"]);
      expect(plan({ includeEnv: true }).files).toContainEqual({
        path: ".config/nvim/.env",
        size: 6,
        group: "secrets",
        target: ".config/nvim",
      });
    });
  });

  describe("config-all group", () => {
    beforeEach(() => {
      createFile(home, ".config/nvim/init.lua", "-- core");
      createFile(home, ".config/tool/config.toml", "a = 1");
      createFile(home, ".config/tool/Cache/blob", "xxxx");
      createFile(home, ".config/tool/.env", "SECRET=1");
      createFile(home, ".config/Code/User/settings.json", "{}");
      createFile(home, ".config/Code/Cache/x", "cached");
    });

    it("is off by default", () => {
      expect(paths(plan())).toEqual([".config/nvim/init.lua", ".config/Code/User/settings.json"]);
    });

    it("adds everything under ~/.config minus excludes and files already claimed by core", () => {
      const p = plan({ includeConfig: true });

      expect(p.files).toEqual([
        { path: ".config/nvim/init.lua", size: 7, group: "core", target: ".config/nvim" },
        {
          path: ".config/Code/User/settings.json",
          size: 2,
          group: "core",
          target: ".config/Code/User/settings.json",
        },
        { path: ".config/tool/config.toml", size: 5, group: "config-all", target: ".config" },
      ]);
    });

    it("hands .env files under ~/.config to the secrets group", () => {
      expect(paths(plan({ includeConfig: true }))).not.toContain(".config/tool/.env");
      expect(paths(plan({ includeConfig: true, includeEnv: true }))).toContain(".config/tool/.env");
    });

    it("reports a missing ~/.config only when requested", () => {
      rmSync(join(home, ".config"), { recursive: true });

      expect(plan({ includeConfig: true }).missing).toContainEqual({
        path: ".config",
        group: "config-all",
      });
    });
  });

  describe("config file includes and excludes", () => {
    it("plans include entries as the custom group and reports missing ones", () => {
      createFile(home, "notes/todo.md", "todo");

      const p = plan({ config: config('[files]\ninclude = ["notes/todo.md", "absent.txt"]') });

      expect(p.files).toEqual([
        { path: "notes/todo.md", size: 4, group: "custom", target: "notes/todo.md" },
      ]);
      expect(p.found).toContainEqual({
        path: "notes/todo.md",
        group: "custom",
        category: CUSTOM_CATEGORY,
      });
      expect(p.missing).toContainEqual({ path: "absent.txt", group: "custom" });
    });

    it("applies excludes by directory name and by path", () => {
      createFile(home, ".config/app/a.toml");
      createFile(home, ".config/app/secret/x");
      createFile(home, ".config/app/tmp/y");
      createFile(home, ".config/app/tmp-other/z");

      const p = plan({
        config: config(
          '[files]\ninclude = [".config/app"]\nexclude = ["secret", ".config/app/tmp"]'
        ),
      });

      expect(paths(p)).toEqual([".config/app/a.toml", ".config/app/tmp-other/z"]);
    });

    it("lets an exclude drop a core target entirely", () => {
      createFile(home, ".zshrc");
      createFile(home, ".bashrc");

      const p = plan({ config: config('[files]\nexclude = [".zshrc"]') });

      expect(paths(p)).toEqual([".bashrc"]);
      expect(p.found.map((f) => f.path)).not.toContain(".zshrc");
      expect(p.missing.map((m) => m.path)).not.toContain(".zshrc");
    });

    it("does not plan a file twice when core and include overlap", () => {
      createFile(home, ".config/nvim/init.lua");

      const p = plan({ config: config('[files]\ninclude = [".config/nvim"]') });

      expect(paths(p)).toEqual([".config/nvim/init.lua"]);
      expect(p.files[0].group).toBe("core");
    });
  });

  describe("size cap", () => {
    it("moves files over the cap to tooLarge and keeps the rest", () => {
      createFile(home, ".zshrc", Buffer.alloc(1024 * 1024 + 1));
      createFile(home, ".bashrc", "1234");

      const p = plan({ maxFileSizeMb: 1 });

      expect(paths(p)).toEqual([".bashrc"]);
      expect(p.tooLarge).toEqual([
        { path: ".zshrc", size: 1024 * 1024 + 1, group: "core", target: ".zshrc" },
      ]);
      expect(p.totalBytes).toBe(4);
    });

    it("keeps a file exactly at the cap", () => {
      createFile(home, ".zshrc", Buffer.alloc(1024 * 1024));

      expect(paths(plan({ maxFileSizeMb: 1 }))).toEqual([".zshrc"]);
    });

    it("honours settings.max_file_size_mb from the config file", () => {
      createFile(home, ".zshrc", Buffer.alloc(3 * 1024 * 1024));

      expect(plan({ config: config("[settings]\nmax_file_size_mb = 2") }).tooLarge).toHaveLength(1);
      expect(plan({ config: config("[settings]\nmax_file_size_mb = 4") }).tooLarge).toHaveLength(0);
    });
  });

  describe("symlinks and unreadable entries", () => {
    it("follows a symlinked file and records the target's size", () => {
      createFile(home, "real-zshrc", "export FOO=1");
      symlinkSync(join(home, "real-zshrc"), join(home, ".zshrc"));

      expect(plan().files).toEqual([{ path: ".zshrc", size: 12, group: "core", target: ".zshrc" }]);
    });

    it("follows a symlinked directory", () => {
      createFile(home, "real-nvim/init.lua", "-- vim");
      mkdirSync(join(home, ".config"));
      symlinkSync(join(home, "real-nvim"), join(home, ".config/nvim"));

      expect(paths(plan())).toEqual([".config/nvim/init.lua"]);
    });

    it("dereferences symlinks nested inside a directory target", () => {
      createFile(home, "target.conf", "nested");
      mkdirSync(join(home, ".config/kitty"), { recursive: true });
      symlinkSync(join(home, "target.conf"), join(home, ".config/kitty/kitty.conf"));

      expect(plan().files).toEqual([
        { path: ".config/kitty/kitty.conf", size: 6, group: "core", target: ".config/kitty" },
      ]);
    });

    it("reports a symlink loop as failed and still plans the rest of the directory", () => {
      createFile(home, ".config/nvim/init.lua");
      symlinkSync(join(home, ".config/nvim"), join(home, ".config/nvim/self"));

      const p = plan();

      expect(paths(p)).toEqual([".config/nvim/init.lua"]);
      expect(p.failed).toEqual([
        {
          path: ".config/nvim/self",
          group: "core",
          error: "symlink loop detected at .config/nvim/self",
        },
      ]);
    });

    it("reports a broken symlink as failed rather than silently missing", () => {
      symlinkSync(join(home, "does-not-exist"), join(home, ".vimrc"));
      expect(lstatSync(join(home, ".vimrc")).isSymbolicLink()).toBe(true);

      const p = plan();

      expect(p.failed).toEqual([{ path: ".vimrc", group: "core", error: "broken symlink" }]);
      expect(p.missing.map((m) => m.path)).not.toContain(".vimrc");
      expect(p.found.map((f) => f.path)).toContain(".vimrc");
    });

    it("reports a socket as failed instead of trying to read it", async () => {
      createFile(home, ".config/nvim/init.lua");
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(join(home, ".config/nvim/sock"), resolve));

      try {
        const p = plan();

        expect(paths(p)).toEqual([".config/nvim/init.lua"]);
        expect(p.failed).toEqual([
          { path: ".config/nvim/sock", group: "core", error: "not a regular file" },
        ]);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("option precedence", () => {
    const settings = config(
      [
        "[settings]",
        "include_env = true",
        "include_config = true",
        'formats = ["zip"]',
        'out = "backups"',
        "max_file_size_mb = 5",
      ].join("\n")
    );

    it("lets config settings override the defaults", () => {
      const p = plan({ config: settings });

      expect(p.includeEnv).toBe(true);
      expect(p.includeConfig).toBe(true);
      expect(p.formats).toEqual(["zip"]);
      expect(p.outDir).toBe(join(home, "backups"));
      expect(p.maxFileSizeMb).toBe(5);
    });

    it("lets explicit options override config settings", () => {
      const p = plan({
        config: settings,
        includeEnv: false,
        includeConfig: false,
        formats: ["tar"],
        outDir: join(home, "elsewhere"),
        maxFileSizeMb: 1,
      });

      expect(p.includeEnv).toBe(false);
      expect(p.includeConfig).toBe(false);
      expect(p.formats).toEqual(["tar"]);
      expect(p.outDir).toBe(join(home, "elsewhere"));
      expect(p.maxFileSizeMb).toBe(1);
    });

    it("expands ~/ and resolves relative output directories against home", () => {
      expect(plan({ outDir: "~/b" }).outDir).toBe(join(home, "b"));
      expect(plan({ outDir: "~" }).outDir).toBe(home);
      expect(plan({ outDir: "rel/out" }).outDir).toBe(join(home, "rel/out"));
    });

    it("reads the config from the home directory when none is passed", () => {
      createFile(home, ".dotfilesrc.toml", '[settings]\nformats = ["tar"]');

      expect(plan().formats).toEqual(["tar"]);
    });
  });
});

describe("filterPlan", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempDir();
    createFile(home, ".zshrc");
    createFile(home, ".config/nvim/init.lua");
    createFile(home, ".config/nvim/.env");
    createFile(home, ".config/tool/config.toml");
    createFile(home, ".npmrc");
    createFile(home, "projects/app/.env");
    createFile(home, "notes/todo.md");
    createFile(home, "big.bin", Buffer.alloc(1024 * 1024 + 1));
    symlinkSync(join(home, ".config/nvim"), join(home, ".config/nvim/self"));
    createFile(
      home,
      ".dotfilesrc.toml",
      '[files]\ninclude = ["notes/todo.md", "big.bin", "absent"]\n[settings]\nmax_file_size_mb = 1'
    );
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("gives the same result as scanning fresh with those options", () => {
    const full = resolveTargets({
      homeDir: home,
      now: FIXED_DATE,
      includeEnv: true,
      includeConfig: true,
    });

    for (const includeEnv of [false, true]) {
      for (const includeConfig of [false, true]) {
        const options = { includeEnv, includeConfig, formats: ["zip", "tar"] as const };
        const fresh = resolveTargets({ homeDir: home, now: FIXED_DATE, ...options });

        expect(filterPlan(full, { ...options, now: FIXED_DATE })).toEqual(fresh);
      }
    }
  });

  it("recomputes the name and outputs for the new timestamp and formats", () => {
    const full = resolveTargets({ homeDir: home, now: FIXED_DATE });

    const later = filterPlan(full, { formats: ["tar"], now: new Date(2027, 0, 1, 0, 0, 0) });

    expect(later.name).toBe("dotfiles-20270101-000000");
    expect(later.outputs).toEqual({ tar: join(home, "dotfiles-20270101-000000.tar.gz") });
    expect(later.files).toEqual(full.files);
  });
});
