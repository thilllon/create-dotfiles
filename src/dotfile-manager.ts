import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
    this.backupDir = join(this.homeDir, config.settings?.backup_dir ?? ".dotfiles");
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

  restore(): void {
    console.log("\n[Restore] Copying dotfiles from backup to home directory...\n");

    if (!existsSync(this.backupDir)) {
      console.error(`Backup directory not found: ${this.backupDir}`);
      process.exit(1);
    }

    for (const file of this.files) {
      const srcPath = join(this.backupDir, file);
      const destPath = join(this.homeDir, file);

      try {
        if (!existsSync(srcPath)) {
          console.log(`  [SKIP] ${file}: not in backup`);
          continue;
        }

        if (existsSync(destPath)) {
          throw new Error(`already exists at ${destPath}`);
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
    return parse(content) as DotfilesConfig;
  }

  private ensureBackupDir(): void {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
      console.log(`Created backup directory: ${this.backupDir}`);
    }

    if (!lstatSync(this.backupDir).isDirectory()) {
      throw new Error(`${this.backupDir} is not a directory`);
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
      [this.backupDir.replace(`${this.homeDir}/`, "")]
    );
    return archivePath;
  }

  private copyFile(srcPath: string, destPath: string): void {
    const stat = lstatSync(srcPath);

    if (stat.isDirectory()) {
      cpSync(srcPath, destPath, { recursive: true, force: true });
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
  }
}
