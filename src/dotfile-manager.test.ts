import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { list as tarList } from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DotfileError, DotfileManager } from "./dotfile-manager";

describe("DotfileManager", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "dotfiles-test-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeConfig(content: string) {
    writeFileSync(join(tempHome, ".dotfilesrc.toml"), content);
  }

  function createFile(relativePath: string, content = "test") {
    const fullPath = join(tempHome, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }

  /** Captures stdout/stderr lines so the [OK]/[FAIL]/[SKIP] contract can be asserted. */
  function captureOutput() {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
    return { out, err };
  }

  async function archiveEntries(): Promise<string[]> {
    const entries: string[] = [];
    await tarList({
      file: join(tempHome, ".dotfiles-backup.tar.gz"),
      onReadEntry: (e) => entries.push(e.path),
    });
    return entries;
  }

  describe("backup", () => {
    it("should copy files to backup directory", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      createFile(".testrc", "my config");

      await new DotfileManager(tempHome).backup();

      const backupPath = join(tempHome, ".dotfiles", ".testrc");
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, "utf8")).toBe("my config");
    });

    it("should copy directories recursively", async () => {
      writeConfig(`[files]\nlist = [".config/myapp"]\n`);
      mkdirSync(join(tempHome, ".config", "myapp"), { recursive: true });
      writeFileSync(join(tempHome, ".config", "myapp", "settings.json"), "{}");

      await new DotfileManager(tempHome).backup();

      const backupPath = join(tempHome, ".dotfiles", ".config", "myapp", "settings.json");
      expect(readFileSync(backupPath, "utf8")).toBe("{}");
    });

    it("should use custom backup_dir from config", async () => {
      writeConfig(`[settings]\nbackup_dir = ".my-backup"\n\n[files]\nlist = [".testrc"]\n`);
      createFile(".testrc", "data");

      await new DotfileManager(tempHome).backup();

      expect(existsSync(join(tempHome, ".my-backup", ".testrc"))).toBe(true);
    });

    it("should log a [FAIL] line for missing source files without throwing", async () => {
      writeConfig(`[files]\nlist = [".nonexistent"]\n`);
      const { err } = captureOutput();

      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();

      expect(err.some((l) => l.includes("[FAIL] .nonexistent"))).toBe(true);
    });

    it("should log an [OK] line per copied file", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      createFile(".testrc");
      const { out } = captureOutput();

      await new DotfileManager(tempHome).backup();

      expect(out.some((l) => l.includes("[OK] .testrc"))).toBe(true);
    });

    it("should continue backing up remaining files after one fails", async () => {
      writeConfig(`[files]\nlist = [".missing", ".present"]\n`);
      createFile(".present", "here");

      await new DotfileManager(tempHome).backup();

      expect(existsSync(join(tempHome, ".dotfiles", ".present"))).toBe(true);
    });

    it("should throw DotfileError when the backup path is a file", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      writeFileSync(join(tempHome, ".dotfiles"), "i am a file");
      createFile(".testrc");

      await expect(new DotfileManager(tempHome).backup()).rejects.toThrow(DotfileError);
    });

    it("should overwrite an existing backup when run twice", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      createFile(".testrc", "v1");
      await new DotfileManager(tempHome).backup();

      createFile(".testrc", "v2");
      await new DotfileManager(tempHome).backup();

      expect(readFileSync(join(tempHome, ".dotfiles", ".testrc"), "utf8")).toBe("v2");
    });
  });

  describe("backup: symlinks", () => {
    it("should follow a symlink to a file and store its content", async () => {
      writeConfig(`[files]\nlist = [".zshrc"]\n`);
      writeFileSync(join(tempHome, "real-zshrc"), "export FOO=1");
      symlinkSync(join(tempHome, "real-zshrc"), join(tempHome, ".zshrc"));

      await new DotfileManager(tempHome).backup();

      const backupPath = join(tempHome, ".dotfiles", ".zshrc");
      expect(readFileSync(backupPath, "utf8")).toBe("export FOO=1");
      expect(lstatSync(backupPath).isSymbolicLink()).toBe(false);
    });

    it("should follow a symlink to a directory instead of failing with EISDIR", async () => {
      writeConfig(`[files]\nlist = [".config/nvim"]\n`);
      mkdirSync(join(tempHome, "real-nvim"), { recursive: true });
      writeFileSync(join(tempHome, "real-nvim", "init.lua"), "-- vim");
      mkdirSync(join(tempHome, ".config"), { recursive: true });
      symlinkSync(join(tempHome, "real-nvim"), join(tempHome, ".config", "nvim"));

      await new DotfileManager(tempHome).backup();

      const backupPath = join(tempHome, ".dotfiles", ".config", "nvim", "init.lua");
      expect(readFileSync(backupPath, "utf8")).toBe("-- vim");
    });

    it("should dereference symlinks nested inside a copied directory", async () => {
      writeConfig(`[files]\nlist = [".config/app"]\n`);
      writeFileSync(join(tempHome, "target.conf"), "nested");
      mkdirSync(join(tempHome, ".config", "app"), { recursive: true });
      symlinkSync(join(tempHome, "target.conf"), join(tempHome, ".config", "app", "link.conf"));

      await new DotfileManager(tempHome).backup();

      const backupPath = join(tempHome, ".dotfiles", ".config", "app", "link.conf");
      expect(readFileSync(backupPath, "utf8")).toBe("nested");
      expect(lstatSync(backupPath).isSymbolicLink()).toBe(false);
    });

    it("should report a symlink loop as [FAIL] rather than recursing forever", async () => {
      writeConfig(`[files]\nlist = [".config/loop"]\n`);
      mkdirSync(join(tempHome, ".config", "loop"), { recursive: true });
      symlinkSync(join(tempHome, ".config", "loop"), join(tempHome, ".config", "loop", "self"));
      const { err } = captureOutput();

      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();

      expect(err.some((l) => l.includes("[FAIL] .config/loop"))).toBe(true);
    });

    it("should report a broken symlink as [FAIL] rather than crashing", async () => {
      writeConfig(`[files]\nlist = [".broken"]\n`);
      symlinkSync(join(tempHome, "does-not-exist"), join(tempHome, ".broken"));
      const { err } = captureOutput();

      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();

      expect(err.some((l) => l.includes("[FAIL] .broken"))).toBe(true);
    });
  });

  describe("backup: archive", () => {
    it("should create a gzip-compressed archive", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      createFile(".testrc", "archive me");

      await new DotfileManager(tempHome).backup();

      const bytes = readFileSync(join(tempHome, ".dotfiles-backup.tar.gz"));
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });

    it("should include the backed up files in the archive", async () => {
      writeConfig(`[files]\nlist = [".testrc", ".config/app/x.json"]\n`);
      createFile(".testrc", "hello");
      createFile(".config/app/x.json", "{}");

      await new DotfileManager(tempHome).backup();

      const entries = await archiveEntries();
      expect(entries).toContain(".dotfiles/.testrc");
      expect(entries).toContain(".dotfiles/.config/app/x.json");
    });

    it("should archive a custom backup_dir under its own name", async () => {
      writeConfig(`[settings]\nbackup_dir = ".my-backup"\n\n[files]\nlist = [".testrc"]\n`);
      createFile(".testrc", "x");

      await new DotfileManager(tempHome).backup();

      expect(await archiveEntries()).toContain(".my-backup/.testrc");
    });

    it("should not contain absolute paths", async () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      createFile(".testrc");

      await new DotfileManager(tempHome).backup();

      for (const entry of await archiveEntries()) {
        expect(entry.startsWith("/")).toBe(false);
      }
    });
  });

  describe("restore", () => {
    function seedBackup(relativePath: string, content: string) {
      const full = join(tempHome, ".dotfiles", relativePath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }

    it("should copy files from backup to home", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      seedBackup(".testrc", "restored config");

      new DotfileManager(tempHome).restore();

      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("restored config");
    });

    it("should log a [SKIP] line for files not in the backup", () => {
      writeConfig(`[files]\nlist = [".missing"]\n`);
      mkdirSync(join(tempHome, ".dotfiles"), { recursive: true });
      const { out } = captureOutput();

      new DotfileManager(tempHome).restore();

      expect(out.some((l) => l.includes("[SKIP] .missing"))).toBe(true);
    });

    it("should not overwrite an existing file by default", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      seedBackup(".testrc", "backup");
      writeFileSync(join(tempHome, ".testrc"), "existing");
      const { err } = captureOutput();

      new DotfileManager(tempHome).restore();

      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("existing");
      expect(err.some((l) => l.includes("[FAIL] .testrc") && l.includes("--force"))).toBe(true);
    });

    it("should overwrite an existing file with force", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);
      seedBackup(".testrc", "backup");
      writeFileSync(join(tempHome, ".testrc"), "existing");

      new DotfileManager(tempHome).restore({ force: true });

      expect(readFileSync(join(tempHome, ".testrc"), "utf8")).toBe("backup");
    });

    it("should restore a directory into an existing directory with force", () => {
      writeConfig(`[files]\nlist = [".config/nvim"]\n`);
      seedBackup(".config/nvim/init.lua", "backed up");
      mkdirSync(join(tempHome, ".config", "nvim"), { recursive: true });

      new DotfileManager(tempHome).restore({ force: true });

      expect(readFileSync(join(tempHome, ".config", "nvim", "init.lua"), "utf8")).toBe("backed up");
    });

    it("should throw DotfileError when the backup directory is missing", () => {
      writeConfig(`[files]\nlist = [".testrc"]\n`);

      expect(() => new DotfileManager(tempHome).restore()).toThrow(DotfileError);
    });

    it("should continue restoring remaining files after one fails", () => {
      writeConfig(`[files]\nlist = [".blocked", ".free"]\n`);
      seedBackup(".blocked", "b");
      seedBackup(".free", "f");
      writeFileSync(join(tempHome, ".blocked"), "existing");

      new DotfileManager(tempHome).restore();

      expect(readFileSync(join(tempHome, ".free"), "utf8")).toBe("f");
    });
  });

  describe("config parsing", () => {
    it("should handle an empty file list", async () => {
      writeConfig(`[files]\nlist = []\n`);
      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();
    });

    it("should handle a missing [files] section", async () => {
      writeConfig(`[settings]\nbackup_dir = ".dotfiles"\n`);
      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();
    });

    it("should handle a [files] section with no list key", async () => {
      writeConfig(`[files]\n`);
      await expect(new DotfileManager(tempHome).backup()).resolves.not.toThrow();
    });

    it("should auto-create the config if missing", () => {
      const configPath = join(tempHome, ".dotfilesrc.toml");
      expect(existsSync(configPath)).toBe(false);

      new DotfileManager(tempHome);

      const content = readFileSync(configPath, "utf8");
      expect(content).toContain("[settings]");
      expect(content).toContain("[files]");
      expect(content).toContain(".zshrc");
    });

    it("should produce an auto-created config that parses cleanly", () => {
      new DotfileManager(tempHome);
      expect(() => new DotfileManager(tempHome)).not.toThrow();
    });

    it("should throw DotfileError on malformed TOML", () => {
      writeConfig(`[files\nlist = broken`);
      expect(() => new DotfileManager(tempHome)).toThrow(DotfileError);
    });

    it("should reject a non-array files.list", () => {
      writeConfig(`[files]\nlist = ".zshrc"\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/must be an array/);
    });

    it("should reject non-string entries in files.list", () => {
      writeConfig(`[files]\nlist = [1, 2]\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/non-empty strings/);
    });

    it("should reject a files.list entry escaping the home directory", () => {
      writeConfig(`[files]\nlist = ["../escape.txt"]\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/must stay inside/);
    });

    it("should reject an absolute files.list entry", () => {
      writeConfig(`[files]\nlist = ["/etc/passwd"]\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/must be a relative path/);
    });

    it("should reject a non-string backup_dir", () => {
      writeConfig(`[settings]\nbackup_dir = 42\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/must be a string/);
    });

    it("should reject a backup_dir escaping the home directory", () => {
      writeConfig(`[settings]\nbackup_dir = "../elsewhere"\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(/must stay inside/);
    });

    it('should reject backup_dir "." which would archive the home directory into itself', () => {
      writeConfig(`[settings]\nbackup_dir = "."\n`);
      expect(() => new DotfileManager(tempHome)).toThrow(DotfileError);
    });
  });
});
