import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";

interface DotfilesConfig {
  settings?: {
    backup_dir?: string;
  };
  files?: {
    list?: string[];
  };
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
    this.backupDir = join(this.homeDir, config.settings?.backup_dir ?? ".dotfiles");
    this.files = config.files?.list ?? [];
  }

  backup(): void {
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

    console.log("\nBackup complete!");
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
      console.error(`Config file not found: ${this.configPath}`);
      console.log(`Create a ${DotfileManager.CONFIG_FILE} file in your home directory.`);
      process.exit(1);
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
