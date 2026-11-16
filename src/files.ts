import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { BACKSLASHES } from "./constants";

/**
 * Every home-relative path is `/`-separated inside this package, whatever the host: target
 * lists, plan entries, summaries, restore listings and archive entry names all use `/`.
 * Conversion to the native form happens only at the filesystem boundary, where
 * `path.join(homeDir, posixPath)` accepts `/` on Windows as well; anything that comes back
 * from the filesystem with native separators is converted here before it is kept.
 */
export class PathUtils {
  /**
   * Converts a native path to `/` separators. `separator` is the host's by default; pass
   * `path.win32.sep` to convert a Windows-style path on any host (tests do).
   */
  static toPosix(path: string, separator: string = sep): string {
    return separator === "/" ? path : path.split(separator).join("/");
  }

  /**
   * Turns every `\` into `/`. Used for user-written paths (config entries, `~\...`), which on
   * Windows are as likely to be spelled with backslashes as not.
   */
  static normalizeSlashes(path: string): string {
    return path.replace(BACKSLASHES, "/");
  }

  /**
   * The entry name of a collected file inside the zip or tar: `<collection name>/<posix path>`.
   * yazl throws on a backslash ("invalid characters in path"), and the tar is read with `/` on
   * every platform, so both get the `/` form even if the relative path arrived native.
   */
  static archiveEntryName(
    collectionName: string,
    relPath: string,
    separator: string = sep
  ): string {
    return `${collectionName}/${PathUtils.toPosix(relPath, separator)}`;
  }

  /**
   * Whether two resolved absolute paths name the same location. Windows paths compare
   * case-insensitively (`C:\Users\me` and `c:\users\me` are one directory); elsewhere the
   * comparison is exact.
   */
  static isSamePath(a: string, b: string, platform: string = process.platform): boolean {
    return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  /**
   * Drops trailing `/` characters, keeping at least `minLength` characters (1 keeps a lone `/`).
   * A loop rather than `/\/+$/`, which backtracks polynomially on input with many slashes.
   */
  static trimTrailingSlashes(path: string, minLength = 0): string {
    let end = path.length;
    while (end > minLength && path[end - 1] === "/") {
      end--;
    }
    return path.slice(0, end);
  }

  /** `~` and `~/x` (or `~\\x`, as Windows users write it) resolve against the home directory. */
  static expandHome(path: string, homeDir: string): string {
    if (path === "~") {
      return homeDir;
    }
    if (path.startsWith("~/") || path.startsWith("~\\")) {
      return join(homeDir, path.slice(2));
    }
    return path;
  }

  /** True if the path exists at all, including a symlink whose target is gone. */
  static entryExists(absPath: string): boolean {
    try {
      lstatSync(absPath);
      return true;
    } catch {
      return false;
    }
  }

  static isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  /** Copies one file, creating the destination's parent directories as needed. */
  static copyInto(srcPath: string, destPath: string): void {
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
  }
}

export interface WalkedFile {
  /** Path relative to the walk root, `/` separated. */
  path: string;
  size: number;
}

export interface WalkHandlers {
  onFile: (file: WalkedFile) => void;
  onError: (relPath: string, error: Error) => void;
  /** Called for every child before it is visited; return true to leave it out. */
  shouldSkip?: (relPath: string) => boolean;
}

/**
 * Lists the regular files under a path, following symlinks at every level so the collection
 * holds real content: a copy full of links back into $HOME would not restore on another
 * machine. `cpSync`'s `dereference` only covers the top-level path, hence the walk.
 */
export class FileWalker {
  /**
   * The resolved paths of the directories currently being walked, so a symlink pointing at one
   * of its own ancestors is reported instead of recursing forever.
   */
  private readonly seen = new Set<string>();

  constructor(private readonly handlers: WalkHandlers) {}

  walk(absPath: string, relPath: string): void {
    let stat: Stats;
    try {
      stat = statSync(absPath);
    } catch (err) {
      this.handlers.onError(relPath, describeStatError(absPath, err as NodeJS.ErrnoException));
      return;
    }

    if (!stat.isDirectory()) {
      if (stat.isFile()) {
        this.handlers.onFile({ path: relPath, size: stat.size });
      } else {
        // Sockets, FIFOs and devices: opening a FIFO for reading would block forever.
        this.handlers.onError(relPath, new Error("not a regular file"));
      }
      return;
    }

    let realPath: string;
    try {
      realPath = realpathSync(absPath);
    } catch (err) {
      // A directory whose real path cannot be resolved (a reparse point the process may not
      // follow, EPERM on Windows) is reported like any other unreadable entry.
      this.handlers.onError(relPath, err as Error);
      return;
    }
    if (this.seen.has(realPath)) {
      this.handlers.onError(relPath, new Error(`symlink loop detected at ${relPath}`));
      return;
    }
    this.seen.add(realPath);

    let entries: string[];
    try {
      entries = readdirSync(absPath).sort();
    } catch (err) {
      this.seen.delete(realPath);
      this.handlers.onError(relPath, err as Error);
      return;
    }

    for (const entry of entries) {
      const childRel = relPath === "" ? entry : `${relPath}/${entry}`;
      if (this.handlers.shouldSkip?.(childRel)) {
        continue;
      }
      this.walk(join(absPath, entry), childRel);
    }

    this.seen.delete(realPath);
  }
}

function describeStatError(absPath: string, err: NodeJS.ErrnoException): Error {
  if (err.code === "ENOENT") {
    try {
      if (lstatSync(absPath).isSymbolicLink()) {
        return new Error("broken symlink");
      }
    } catch {
      // The entry vanished between readdir and stat; report the original error.
    }
  }
  return err;
}
