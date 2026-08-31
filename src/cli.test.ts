import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Vitest runs with the project root as cwd, so paths resolve from there.
const repoRoot = process.cwd();
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "cli.ts");

describe("cli", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "dotfiles-cli-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  /** Runs the CLI in a subprocess with $HOME pointed at a throwaway directory. */
  function runCli(...args: string[]) {
    const result = spawnSync(tsxBin, [cliPath, ...args], {
      env: { ...process.env, HOME: tempHome },
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  const configPath = () => join(tempHome, ".dotfilesrc.toml");

  function writeConfig(content: string) {
    writeFileSync(configPath(), content);
  }

  describe("--help / --version", () => {
    it("should print usage and exit zero", () => {
      const { status, stdout } = runCli("--help");

      expect(status).toBe(0);
      expect(stdout).toContain("create-dotfiles");
      expect(stdout).toContain("restore");
    });

    it("should NOT create a config file as a side effect of --help", () => {
      runCli("--help");

      expect(existsSync(configPath())).toBe(false);
    });

    it("should NOT create a config file as a side effect of --version", () => {
      const { status } = runCli("--version");

      expect(status).toBe(0);
      expect(existsSync(configPath())).toBe(false);
    });

    it("should not print config chatter above the help text", () => {
      const { stdout } = runCli("--help");

      expect(stdout).not.toContain("Config file not found");
    });
  });

  describe("unknown commands", () => {
    it("should reject an unknown command instead of silently backing up", () => {
      const { status, output } = runCli("bogus");

      expect(status).toBe(1);
      expect(output).toContain("Unknown command: bogus");
      expect(existsSync(join(tempHome, ".dotfiles"))).toBe(false);
    });
  });

  describe("backup", () => {
    it("should back up files and create an archive with the default command", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      writeFileSync(join(tempHome, ".testrc"), "hello");

      const { status, stdout } = runCli();

      expect(status).toBe(0);
      expect(stdout).toContain("[OK] .testrc");
      expect(readFileSync(join(tempHome, ".dotfiles", ".testrc"), "utf8")).toBe("hello");
      expect(existsSync(join(tempHome, ".dotfiles-backup.tar.gz"))).toBe(true);
    });

    it("should create a default config on first real run", () => {
      const { status, stdout } = runCli();

      expect(status).toBe(0);
      expect(stdout).toContain("Config file not found");
      expect(existsSync(configPath())).toBe(true);
    });
  });

  describe("restore", () => {
    it("should restore files from the backup directory", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      mkdirSync(join(tempHome, ".dotfiles"), { recursive: true });
      writeFileSync(join(tempHome, ".dotfiles", ".testrc"), "restored");

      const { status } = runCli("restore");

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("restored");
    });

    it("should exit non-zero with a friendly error when no backup exists", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);

      const { status, output } = runCli("restore");

      expect(status).toBe(1);
      expect(output).toContain("Backup directory not found");
      expect(output).not.toContain("at Object.");
    });

    it("should refuse to overwrite without --force", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      mkdirSync(join(tempHome, ".dotfiles"), { recursive: true });
      writeFileSync(join(tempHome, ".dotfiles", ".testrc"), "backup");
      writeFileSync(join(tempHome, ".testrc"), "existing");

      runCli("restore");

      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("existing");
    });

    it("should overwrite with --force", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      mkdirSync(join(tempHome, ".dotfiles"), { recursive: true });
      writeFileSync(join(tempHome, ".dotfiles", ".testrc"), "backup");
      writeFileSync(join(tempHome, ".testrc"), "existing");

      const { status } = runCli("restore", "--force");

      expect(status).toBe(0);
      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("backup");
    });
  });

  describe("config errors", () => {
    it("should report malformed TOML without a stack trace", () => {
      writeConfig(`[files\nlist = broken`);

      const { status, output } = runCli();

      expect(status).toBe(1);
      expect(output).toContain("Invalid TOML");
      expect(output).not.toContain("at Object.");
      expect(output).not.toContain("TomlError:");
    });

    it("should reject a config entry escaping the home directory", () => {
      writeConfig(`[files]\nlist = ["../escape.txt"]\n`);

      const { status, output } = runCli();

      expect(status).toBe(1);
      expect(output).toContain("must stay inside");
    });
  });
});
