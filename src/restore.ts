import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ARCHIVE_PATTERN, COLLECTION_NAME_PATTERN } from "./constants";
import { DotfileError } from "./errors";
import { FileWalker, PathUtils } from "./files";

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

/**
 * Copies every file in a collection folder back to the same relative path under the home
 * directory. Existing files are skipped unless `force` is set; nothing else is ever deleted.
 */
export class Restorer {
  readonly homeDir: string;
  readonly force: boolean;
  readonly source: string;

  /** Resolves the source folder; an unusable one is a {@link DotfileError}. */
  constructor(options: RestoreOptions = {}) {
    this.homeDir = resolve(options.homeDir ?? homedir());
    this.force = options.force ?? false;
    this.source = this.resolveSource(options.source);
  }

  /** Resolves the options and restores in one step. */
  static restore(options: RestoreOptions = {}): RestoreSummary {
    return new Restorer(options).run();
  }

  /** The newest `dotfiles-YYYYMMDD-HHMMSS` folder in `homeDir` (the name sorts by time). */
  static findLatestCollection(homeDir: string): string | undefined {
    const names = readdirSync(homeDir)
      .filter(
        (name) => COLLECTION_NAME_PATTERN.test(name) && PathUtils.isDirectory(join(homeDir, name))
      )
      .sort();
    const latest = names.at(-1);
    return latest === undefined ? undefined : join(homeDir, latest);
  }

  run(): RestoreSummary {
    const { homeDir, force, source } = this;
    const summary: RestoreSummary = {
      source,
      homeDir,
      force,
      restored: [],
      skipped: [],
      failed: [],
    };

    new FileWalker({
      onFile: (file) => {
        const destPath = join(homeDir, file.path);
        try {
          if (existsSync(destPath) && !force) {
            summary.skipped.push(file.path);
            return;
          }
          PathUtils.copyInto(join(source, file.path), destPath);
          summary.restored.push(file.path);
        } catch (err) {
          summary.failed.push({ path: file.path, error: (err as Error).message });
        }
      },
      onError: (relPath, error) => summary.failed.push({ path: relPath, error: error.message }),
    }).walk(source, "");

    return summary;
  }

  private resolveSource(source: string | undefined): string {
    const { homeDir } = this;
    if (source === undefined) {
      const latest = Restorer.findLatestCollection(homeDir);
      if (latest === undefined) {
        throw new DotfileError(
          `No dotfiles-YYYYMMDD-HHMMSS folder found in ${homeDir}. ` +
            "Run create-dotfiles first, or pass the folder to restore from."
        );
      }
      return latest;
    }

    const expanded = PathUtils.expandHome(source, homeDir);
    let path = resolve(expanded);
    // A bare folder name is most likely one of the collections in the home directory.
    if (!existsSync(path) && !isAbsolute(expanded) && existsSync(join(homeDir, expanded))) {
      path = join(homeDir, expanded);
    }

    if (!existsSync(path)) {
      throw new DotfileError(`Restore source not found: ${path}`);
    }
    if (!PathUtils.isDirectory(path)) {
      if (ARCHIVE_PATTERN.test(path)) {
        throw new DotfileError(
          `Restoring from an archive is not supported: ${path}. ` +
            "Extract it first, then restore from the extracted dotfiles-YYYYMMDD-HHMMSS folder."
        );
      }
      throw new DotfileError(`Restore source must be a directory: ${path}`);
    }
    if (PathUtils.isSamePath(path, homeDir)) {
      throw new DotfileError("Restore source must be a collection folder, not the home directory");
    }
    return path;
  }
}
