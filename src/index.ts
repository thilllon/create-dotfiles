import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_FILE = ".dotfilesrc";
const BACKUP_DIR = ".dotfiles";
const COMMENT_CHAR = "#";

function getHomeDir(): string {
  return os.homedir();
}

function getConfigPath(): string {
  return path.join(getHomeDir(), CONFIG_FILE);
}

function getBackupDir(): string {
  return path.join(getHomeDir(), BACKUP_DIR);
}

function parseConfig(): string[] {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.log(
      `Create a ${CONFIG_FILE} file in your home directory with a list of dotfiles to sync.`
    );
    process.exit(1);
  }

  return fs
    .readFileSync(configPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(COMMENT_CHAR));
}

function ensureBackupDir(): void {
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`Created backup directory: ${backupDir}`);
  }

  if (!fs.lstatSync(backupDir).isDirectory()) {
    throw new Error(`${backupDir} is not a directory`);
  }
}

function backup(): void {
  console.log("\n[Backup] Copying dotfiles to backup directory...\n");

  const files = parseConfig();
  const homeDir = getHomeDir();
  const backupDir = getBackupDir();

  ensureBackupDir();

  for (const file of files) {
    const srcPath = path.join(homeDir, file);
    const destPath = path.join(backupDir, file);

    try {
      const stat = fs.lstatSync(srcPath);

      if (stat.isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }

      console.log(`  [OK] ${file}`);
    } catch (err) {
      console.error(`  [FAIL] ${file}: ${(err as Error).message}`);
    }
  }

  console.log("\nBackup complete!");
}

function restore(): void {
  console.log(
    "\n[Restore] Copying dotfiles from backup to home directory...\n"
  );

  const files = parseConfig();
  const homeDir = getHomeDir();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    console.error(`Backup directory not found: ${backupDir}`);
    process.exit(1);
  }

  for (const file of files) {
    const srcPath = path.join(backupDir, file);
    const destPath = path.join(homeDir, file);

    try {
      if (!fs.existsSync(srcPath)) {
        console.log(`  [SKIP] ${file}: not in backup`);
        continue;
      }

      const stat = fs.lstatSync(srcPath);

      if (stat.isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }

      console.log(`  [OK] ${file}`);
    } catch (err) {
      console.error(`  [FAIL] ${file}: ${(err as Error).message}`);
    }
  }

  console.log("\nRestore complete!");
}

function showHelp(): void {
  console.log(`
Usage: create-dotfiles [command]

Commands:
  backup    Copy dotfiles from home directory to backup folder (default)
  restore   Copy dotfiles from backup folder to home directory
  help      Show this help message

Configuration:
  Create a ${CONFIG_FILE} file in your home directory with a list of dotfiles to sync.
  Lines starting with '${COMMENT_CHAR}' are treated as comments.

Example ${CONFIG_FILE}:
  .zshrc
  .bashrc
  .gitconfig
  # This is a comment
  .config/nvim
`);
}

function main(): void {
  const command = process.argv[2] || "backup";

  switch (command) {
    case "backup":
      backup();
      break;
    case "restore":
      restore();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
