import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { list as tarList } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFile, makeTempDir } from "./test-helpers";

// Vitest runs with the project root as cwd, so paths resolve from there.
const repoRoot = process.cwd();
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "cli.ts");
const COLLECTION = /^dotfiles-\d{8}-\d{6}$/;

describe("cli", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = makeTempDir("dotfiles-cli-");
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  /**
   * Runs the CLI in a subprocess with $HOME pointed at a throwaway directory. stdio are pipes,
   * so the process is never attached to a TTY.
   */
  function runCli(...args: string[]) {
    const result = spawnSync(tsxBin, [cliPath, ...args], {
      env: { ...process.env, HOME: tempHome },
      encoding: "utf8",
      cwd: tmpdir(),
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  const collections = () => readdirSync(tempHome).filter((name) => COLLECTION.test(name));

  describe("--help / --version", () => {
    it("prints usage covering both commands, the flags and the never-copied rules", () => {
      const { status, stdout } = runCli("--help");

      expect(status).toBe(0);
      expect(stdout).toContain("create-dotfiles");
      expect(stdout).toContain("restore");
      for (const flag of [
        "--auto",
        "--include-env",
        "--include-config",
        "--format",
        "--out",
        "--max-file-size",
        "--dry-run",
      ]) {
        expect(stdout).toContain(flag);
      }
      expect(stdout).toContain("SSH private keys");
      expect(stdout).toContain("node_modules");
      expect(stdout).toContain("never enters ~/Library, ~/Desktop, ~/Documents");
      expect(stdout).toContain(".dotfilesrc.toml");
      // Nothing under $HOME is read or written on --help (module scope must stay side-effect free).
      expect(readdirSync(tempHome)).toEqual([]);
    });

    it("documents --force and the default source on restore --help", () => {
      const { status, stdout } = runCli("restore", "--help");

      expect(status).toBe(0);
      expect(stdout).toContain("restore [source]");
      expect(stdout).toContain("--force");
      expect(readdirSync(tempHome)).toEqual([]);
    });

    it("prints the version and leaves the home directory untouched for --version", () => {
      const { status, stdout } = runCli("--version");

      expect(status).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(readdirSync(tempHome)).toEqual([]);
    });
  });

  describe("unknown commands", () => {
    it("rejects an unknown command with exit 1 and collects nothing", () => {
      createFile(tempHome, ".zshrc");

      const { status, output } = runCli("bogus");

      expect(status).toBe(1);
      expect(output).toContain("Unknown command: bogus");
      expect(collections()).toEqual([]);
    });
  });

  describe("default command without a terminal", () => {
    it("says it is not interactive and runs with --auto defaults", () => {
      createFile(tempHome, ".zshrc", "zsh");

      const { status, stdout } = runCli();

      expect(status).toBe(0);
      expect(stdout).toContain("Not running in an interactive terminal; using --auto defaults.");
      const [name] = collections();
      expect(name).toMatch(COLLECTION);
      expect(readFileSync(join(tempHome, name, ".zshrc"), "utf8")).toBe("zsh");
    });

    it("does not print the notice when --auto is given explicitly", () => {
      const { status, stdout } = runCli("--auto");

      expect(status).toBe(0);
      expect(stdout).not.toContain("Not running in an interactive terminal");
      expect(stdout).toContain("Copied 0 files");
    });
  });

  describe("--auto", () => {
    beforeEach(() => {
      createFile(tempHome, ".zshrc", "export ZSH=1");
      createFile(tempHome, ".config/nvim/init.lua", "-- vim");
      createFile(tempHome, ".npmrc", "token");
      createFile(tempHome, "projects/app/.env", "A=1");
      createFile(tempHome, "projects/app/node_modules/pkg/.env", "NOPE=1");
      createFile(tempHome, ".ssh/config", "Host x");
      createFile(tempHome, ".ssh/id_ed25519", "PRIVATE");
    });

    it("collects into folder, zip and tar.gz end to end with --include-env", async () => {
      const { status, stdout } = runCli("--auto", "--format", "folder,zip,tar", "--include-env");

      expect(status).toBe(0);
      const [name] = collections();
      const expected = [
        ".zshrc",
        ".config/nvim/init.lua",
        ".ssh/config",
        ".npmrc",
        "projects/app/.env",
      ];

      for (const rel of expected) expect(existsSync(join(tempHome, name, rel))).toBe(true);
      expect(existsSync(join(tempHome, name, ".ssh/id_ed25519"))).toBe(false);
      expect(existsSync(join(tempHome, name, "projects/app/node_modules/pkg/.env"))).toBe(false);

      const zipNames = Object.keys(unzipSync(readFileSync(join(tempHome, `${name}.zip`)))).sort();
      expect(zipNames).toEqual(expected.map((rel) => `${name}/${rel}`).sort());

      const tarNames: string[] = [];
      await tarList({
        file: join(tempHome, `${name}.tar.gz`),
        onReadEntry: (e) => tarNames.push(e.path),
      });
      for (const rel of expected) expect(tarNames).toContain(`${name}/${rel}`);
      expect(tarNames).not.toContain(`${name}/.ssh/id_ed25519`);

      expect(stdout).toContain("Copied 5 files");
      expect(stdout).toContain("Per group: core 3, custom 0, secrets 2, config-all 0");
      expect(stdout).toContain(`folder: ${join(tempHome, name)}/`);
      expect(stdout).toContain(`zip:    ${join(tempHome, `${name}.zip`)}`);
      expect(stdout).toContain(`tar.gz: ${join(tempHome, `${name}.tar.gz`)}`);
    });

    it("leaves secrets out by default", () => {
      const { stdout } = runCli("--auto");

      const [name] = collections();
      expect(existsSync(join(tempHome, name, ".npmrc"))).toBe(false);
      expect(existsSync(join(tempHome, name, "projects/app/.env"))).toBe(false);
      expect(stdout).toContain("Per group: core 3, custom 0, secrets 0, config-all 0");
    });

    it("--dry-run lists sizes and output paths and writes nothing", () => {
      const before = readdirSync(tempHome).sort();

      const { status, stdout } = runCli("--auto", "--dry-run", "--format", "zip", "--include-env");

      expect(status).toBe(0);
      expect(stdout).toContain("Would copy 5 files");
      expect(stdout).toContain("  .zshrc (12 B) [core]");
      expect(stdout).toContain("  projects/app/.env (3 B) [secrets]");
      expect(stdout).toMatch(/Would write:\n {2}zip: {4}.*dotfiles-\d{8}-\d{6}\.zip/);
      expect(stdout).toContain("Dry run: nothing was written.");
      expect(readdirSync(tempHome).sort()).toEqual(before);
    });

    it("honours --out and --max-file-size", () => {
      createFile(tempHome, ".bashrc", Buffer.alloc(1024 * 1024 + 1));
      const out = join(tempHome, "backups");

      const { status, stdout } = runCli("--auto", "--out", out, "--max-file-size", "1");

      expect(status).toBe(0);
      const [name] = readdirSync(out);
      expect(name).toMatch(COLLECTION);
      expect(existsSync(join(out, name, ".zshrc"))).toBe(true);
      expect(existsSync(join(out, name, ".bashrc"))).toBe(false);
      expect(stdout).toContain("Skipped, larger than 1 MB (1):\n  .bashrc (1.0 MB)");
      expect(collections()).toEqual([]);
    });

    it("--include-config picks up everything under ~/.config", () => {
      createFile(tempHome, ".config/tool/config.toml", "a = 1");

      const { status, stdout } = runCli("--auto", "--include-config");

      expect(status).toBe(0);
      const [name] = collections();
      expect(existsSync(join(tempHome, name, ".config/tool/config.toml"))).toBe(true);
      expect(stdout).toContain("Per group: core 3, custom 0, secrets 0, config-all 1");
    });

    it("rejects an unknown --format value without a stack trace", () => {
      const { status, output } = runCli("--auto", "--format", "rar");

      expect(status).toBe(1);
      expect(output).toContain('Error: Unknown output format "rar"');
      expect(output).not.toContain("    at ");
      expect(collections()).toEqual([]);
    });

    it.each([
      [["--max-file-size", "0"], '"0"'],
      [["--max-file-size=-1"], '"-1"'],
      [["--max-file-size", "lots"], '"NaN"'],
    ])(
      "rejects %j as --max-file-size without a stack trace and collects nothing",
      (args, shown) => {
        const { status, output } = runCli("--auto", ...args);

        expect(status).toBe(1);
        expect(output).toContain(`Error: Invalid max file size ${shown}`);
        expect(output).not.toContain("    at ");
        expect(collections()).toEqual([]);
      }
    );

    it("reads [settings] from ~/.dotfilesrc.toml and lets flags override them", () => {
      writeFileSync(join(tempHome, ".dotfilesrc.toml"), '[settings]\nformats = ["zip"]\n');

      expect(runCli("--auto").status).toBe(0);
      expect(collections()).toEqual([]);
      expect(readdirSync(tempHome).some((n) => /^dotfiles-\d{8}-\d{6}\.zip$/.test(n))).toBe(true);

      expect(runCli("--auto", "--format", "folder").status).toBe(0);
      expect(collections()).toHaveLength(1);
    });

    it("reports malformed config as an error without a stack trace", () => {
      writeFileSync(join(tempHome, ".dotfilesrc.toml"), "[files\ninclude = broken");

      const { status, output } = runCli("--auto");

      expect(status).toBe(1);
      expect(output).toContain("Error: Invalid TOML");
      expect(output).not.toContain("    at ");
      expect(output).not.toContain("TomlError");
      expect(collections()).toEqual([]);
    });

    it("rejects a config include escaping the home directory", () => {
      writeFileSync(join(tempHome, ".dotfilesrc.toml"), '[files]\ninclude = ["../escape.txt"]\n');

      const { status, output } = runCli("--auto");

      expect(status).toBe(1);
      expect(output).toContain("must stay inside");
    });
  });

  describe("restore", () => {
    const older = "dotfiles-20260101-000000";
    const newest = "dotfiles-20260902-110342";

    beforeEach(() => {
      createFile(tempHome, `${older}/.zshrc`, "old");
      createFile(tempHome, `${newest}/.zshrc`, "new");
      createFile(tempHome, `${newest}/.config/nvim/init.lua`, "-- vim");
    });

    it("restores the newest collection folder by default", () => {
      const { status, stdout } = runCli("restore");

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".zshrc"), "utf8")).toBe("new");
      expect(readFileSync(join(tempHome, ".config/nvim/init.lua"), "utf8")).toBe("-- vim");
      expect(stdout).toContain(`Restoring ${join(tempHome, newest)} into ${tempHome}`);
      expect(stdout).toContain("[OK] .zshrc");
      expect(stdout).toContain("Restored 2 files, 0 skipped, 0 failed.");
    });

    it("restores from an explicit source", () => {
      const { status } = runCli("restore", join(tempHome, older));

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".zshrc"), "utf8")).toBe("old");
    });

    it("skips existing files without --force and reports them", () => {
      writeFileSync(join(tempHome, ".zshrc"), "existing");

      const { status, stdout } = runCli("restore");

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".zshrc"), "utf8")).toBe("existing");
      expect(stdout).toContain("[SKIP] .zshrc exists (use --force)");
    });

    it("overwrites with --force", () => {
      writeFileSync(join(tempHome, ".zshrc"), "existing");

      const { status } = runCli("restore", "--force");

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".zshrc"), "utf8")).toBe("new");
    });

    it("exits non-zero with a friendly error when no collection exists", () => {
      rmSync(join(tempHome, older), { recursive: true });
      rmSync(join(tempHome, newest), { recursive: true });

      const { status, output } = runCli("restore");

      expect(status).toBe(1);
      expect(output).toContain("No dotfiles-YYYYMMDD-HHMMSS folder found");
      expect(output).not.toContain("    at ");
    });

    it("refuses an archive path with an explanation", () => {
      writeFileSync(join(tempHome, `${newest}.zip`), "zip");

      const { status, output } = runCli("restore", join(tempHome, `${newest}.zip`));

      expect(status).toBe(1);
      expect(output).toContain("Restoring from an archive is not supported");
    });

    it("does not create anything when the source is missing", () => {
      mkdirSync(join(tempHome, "empty"));

      const { status } = runCli("restore", join(tempHome, "nope"));

      expect(status).toBe(1);
      expect(existsSync(join(tempHome, ".zshrc"))).toBe(false);
    });
  });
});
