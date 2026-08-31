import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "smol-toml";
import { create } from "tar";

interface DotfilesConfig {
  settings?: {
    backup_dir?: string;
  };
  files?: {
    list?: string[];
  };
}

/**
 * An expected, user-facing failure (bad config, missing backup directory).
 * The CLI reports the message and exits non-zero instead of printing a stack trace.
 */
export class DotfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DotfileError";
  }
}

const DEFAULT_CONFIG = `# ~/.dotfilesrc.toml

[settings]
backup_dir = ".dotfiles"

[files]
list = [
  # Shell
  ".zshrc",
  ".bashrc",
  ".bash_profile",

  # Git
  ".gitconfig",
  ".gitignore_global",

  # Editor - Vim/Neovim
  ".vimrc",
  ".config/nvim",

  # Editor - VS Code
  "Library/Application Support/Code/User/settings.json",
  "Library/Application Support/Code/User/keybindings.json",
  "Library/Application Support/Code/User/snippets",

  # Editor - Cursor
  "Library/Application Support/Cursor/User/settings.json",
  "Library/Application Support/Cursor/User/keybindings.json",
  "Library/Application Support/Cursor/User/snippets",

  # Tools
  ".tmux.conf",
  ".config/starship.toml",

  # Node
  ".npmrc",
]
`;

/** Rejects absolute paths and any entry that resolves outside the base directory. */
function assertContainedPath(base: string, entry: string, label: string): void {
  if (isAbsolute(entry)) {
    throw new DotfileError(`${label} must be a relative path, got "${entry}"`);
  }

  const rel = relative(base, resolve(base, entry));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new DotfileError(`${label} must stay inside ${base}, got "${entry}"`);
  }
}

export class DotfileManager {
  private static readonly CONFIG_FILE = ".dotfilesrc.toml";

  private readonly homeDir: string;
  private readonly configPath: string;
  private readonly backupDir: string;
  private readonly files: string[];

  constructor(homeDir?: string) {
    this.homeDir = homeDir ?? homedir();
    this.configPath = join(this.homeDir, DotfileManager.CONFIG_FILE);

    const config = this.parseConfig();
    const backupDirName = config.settings?.backup_dir ?? ".dotfiles";
    assertContainedPath(this.homeDir, backupDirName, "settings.backup_dir");

    this.backupDir = join(this.homeDir, backupDirName);
    this.files = config.files?.list ?? [];
  }

  async backup(): Promise<void> {
    console.log("\n[Backup] Copying dotfiles to backup directory...\n");

    this.ensureBackupDir();

    for (const file of this.files) {
      const srcPath = join(this.homeDir, file);
      const destPath = join(this.backupDir, file);

      try {
        this.copyFile(srcPath, destPath);
        console.log(`  [OK] ${file}`);
      } catch (err) {
        console.error(`  [FAIL] ${file}: ${(err as Error).message}`);
      }
    }

    const archivePath = await this.createArchive();
    console.log(`\nBackup complete! Archive: ${archivePath}`);
  }

  restore({ force = false }: { force?: boolean } = {}): void {
    console.log("\n[Restore] Copying dotfiles from backup to home directory...\n");

    if (!existsSync(this.backupDir)) {
      throw new DotfileError(`Backup directory not found: ${this.backupDir}`);
    }

    for (const file of this.files) {
      const srcPath = join(this.backupDir, file);
      const destPath = join(this.homeDir, file);

      try {
        if (!existsSync(srcPath)) {
          console.log(`  [SKIP] ${file}: not in backup`);
          continue;
        }

        if (existsSync(destPath) && !force) {
          throw new Error(`already exists at ${destPath} (use --force to overwrite)`);
        }

        this.copyFile(srcPath, destPath);
        console.log(`  [OK] ${file}`);
      } catch (err) {
        console.error(`  [FAIL] ${file}: ${(err as Error).message}`);
      }
    }

    console.log("\nRestore complete!");
  }

  private parseConfig(): DotfilesConfig {
    if (!existsSync(this.configPath)) {
      console.log(`Config file not found. Creating default config: ${this.configPath}`);
      writeFileSync(this.configPath, DEFAULT_CONFIG, "utf8");
    }

    const content = readFileSync(this.configPath, "utf8");

    let parsed: unknown;
    try {
      parsed = parse(content);
    } catch (err) {
      throw new DotfileError(`Invalid TOML in ${this.configPath}: ${(err as Error).message}`);
    }

    return this.validateConfig(parsed);
  }

  /** `parse()` returns `unknown`; reject malformed shapes here rather than casting blindly. */
  private validateConfig(parsed: unknown): DotfilesConfig {
    const root = parsed as Record<string, unknown>;
    const config: DotfilesConfig = {};

    const settings = root.settings;
    if (settings !== undefined) {
      const backupDir = (settings as Record<string, unknown>).backup_dir;
      if (backupDir !== undefined && typeof backupDir !== "string") {
        throw new DotfileError(
          `settings.backup_dir must be a string in ${this.configPath}, got ${typeof backupDir}`
        );
      }
      config.settings = { backup_dir: backupDir as string | undefined };
    }

    const files = root.files;
    if (files !== undefined) {
      const list = (files as Record<string, unknown>).list;
      if (list !== undefined) {
        if (!Array.isArray(list)) {
          throw new DotfileError(
            `files.list must be an array in ${this.configPath}, got ${typeof list}`
          );
        }
        for (const entry of list) {
          if (typeof entry !== "string" || entry.trim() === "") {
            throw new DotfileError(
              `files.list entries must be non-empty strings in ${this.configPath}, got ${JSON.stringify(entry)}`
            );
          }
          assertContainedPath(this.homeDir, entry, "files.list entry");
        }
        config.files = { list: list as string[] };
      }
    }

    return config;
  }

  private ensureBackupDir(): void {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
      console.log(`Created backup directory: ${this.backupDir}`);
    }

    if (!statSync(this.backupDir).isDirectory()) {
      throw new DotfileError(`${this.backupDir} is not a directory`);
    }
  }

  private async createArchive(): Promise<string> {
    const archivePath = join(this.homeDir, ".dotfiles-backup.tar.gz");
    await create(
      {
        gzip: true,
        file: archivePath,
        cwd: this.homeDir,
      },
      [relative(this.homeDir, this.backupDir)]
    );
    return archivePath;
  }

  /**
   * Symlinked dotfiles are common, so follow links at every level and copy the real content:
   * a backup holding links back into $HOME would not restore on another machine. `cpSync`'s
   * `dereference` only covers the top-level path, hence the manual walk.
   *
   * `seen` holds the resolved paths of the directories currently being walked, so a symlink
   * pointing at one of its own ancestors is reported instead of recursing forever.
   */
  private copyFile(srcPath: string, destPath: string, seen: Set<string> = new Set()): void {
    const stat = statSync(srcPath);

    if (!stat.isDirectory()) {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      return;
    }

    const realPath = realpathSync(srcPath);
    if (seen.has(realPath)) {
      throw new Error(`symlink loop detected at ${srcPath}`);
    }
    seen.add(realPath);

    mkdirSync(destPath, { recursive: true });
    for (const entry of readdirSync(srcPath)) {
      this.copyFile(join(srcPath, entry), join(destPath, entry), seen);
    }

    seen.delete(realPath);
  }
}
