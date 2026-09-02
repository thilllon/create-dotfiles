import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { DotfileError } from "./errors";
import { expandHome } from "./options";
import { COLLECTION_NAME_PATTERN } from "./targets";
import { copyInto, walk } from "./walk";

export interface RestoreOptions {
  /** Directory to restore into. Defaults to `os.homedir()`. */
  homeDir?: string;
  /**
   * Collection folder to restore from. Defaults to the newest `dotfiles-YYYYMMDD-HHMMSS`
   * folder in the home directory. Archives are not supported; extract them first.
   */
  source?: string;
  /** Overwrite files that already exist. Default false. */
  force?: boolean;
}

export interface RestoreFailure {
  path: string;
  error: string;
}

export interface RestoreSummary {
  source: string;
  homeDir: string;
  force: boolean;
  restored: string[];
  /** Files left alone because they already exist (and `force` was off). */
  skipped: string[];
  failed: RestoreFailure[];
}

const ARCHIVE_PATTERN = /\.(zip|tar\.gz|tgz|tar)$/i;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The newest `dotfiles-YYYYMMDD-HHMMSS` folder in `homeDir` (the name sorts by time). */
export function findLatestCollection(homeDir: string): string | undefined {
  const names = readdirSync(homeDir)
    .filter((name) => COLLECTION_NAME_PATTERN.test(name) && isDirectory(join(homeDir, name)))
    .sort();
  const latest = names.at(-1);
  return latest === undefined ? undefined : join(homeDir, latest);
}

function resolveSource(homeDir: string, source: string | undefined): string {
  if (source === undefined) {
    const latest = findLatestCollection(homeDir);
    if (latest === undefined) {
      throw new DotfileError(
        `No dotfiles-YYYYMMDD-HHMMSS folder found in ${homeDir}. ` +
          "Run create-dotfiles first, or pass the folder to restore from."
      );
    }
    return latest;
  }

  const expanded = expandHome(source, homeDir);
  let path = resolve(expanded);
  // A bare folder name is most likely one of the collections in the home directory.
  if (!existsSync(path) && !isAbsolute(expanded) && existsSync(join(homeDir, expanded))) {
    path = join(homeDir, expanded);
  }

  if (!existsSync(path)) {
    throw new DotfileError(`Restore source not found: ${path}`);
  }
  if (!isDirectory(path)) {
    if (ARCHIVE_PATTERN.test(path)) {
      throw new DotfileError(
        `Restoring from an archive is not supported: ${path}. ` +
          "Extract it first, then restore from the extracted dotfiles-YYYYMMDD-HHMMSS folder."
      );
    }
    throw new DotfileError(`Restore source must be a directory: ${path}`);
  }
  if (path === homeDir) {
    throw new DotfileError("Restore source must be a collection folder, not the home directory");
  }
  return path;
}

/**
 * Copies every file in a collection folder back to the same relative path under the home
 * directory. Existing files are skipped unless `force` is set; nothing else is ever deleted.
 */
export function restore(options: RestoreOptions = {}): RestoreSummary {
  const homeDir = resolve(options.homeDir ?? homedir());
  const force = options.force ?? false;
  const source = resolveSource(homeDir, options.source);
  const summary: RestoreSummary = { source, homeDir, force, restored: [], skipped: [], failed: [] };

  walk(source, "", {
    onFile: (file) => {
      const destPath = join(homeDir, file.path);
      try {
        if (existsSync(destPath) && !force) {
          summary.skipped.push(file.path);
          return;
        }
        copyInto(join(source, file.path), destPath);
        summary.restored.push(file.path);
      } catch (err) {
        summary.failed.push({ path: file.path, error: (err as Error).message });
      }
    },
    onError: (relPath, error) => summary.failed.push({ path: relPath, error: error.message }),
  });

  return summary;
}
