import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  type Stats,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

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

function describeStatError(absPath: string, err: NodeJS.ErrnoException): Error {
  if (err.code === "ENOENT") {
    try {
      if (lstatSync(absPath).isSymbolicLink()) return new Error("broken symlink");
    } catch {
      // The entry vanished between readdir and stat; report the original error.
    }
  }
  return err;
}

/**
 * Lists the regular files under `absPath`, following symlinks at every level so the
 * collection holds real content: a copy full of links back into $HOME would not restore on
 * another machine. `cpSync`'s `dereference` only covers the top-level path, hence the walk.
 *
 * `seen` holds the resolved paths of the directories currently being walked, so a symlink
 * pointing at one of its own ancestors is reported instead of recursing forever.
 */
export function walk(
  absPath: string,
  relPath: string,
  handlers: WalkHandlers,
  seen: Set<string> = new Set()
): void {
  let stat: Stats;
  try {
    stat = statSync(absPath);
  } catch (err) {
    handlers.onError(relPath, describeStatError(absPath, err as NodeJS.ErrnoException));
    return;
  }

  if (!stat.isDirectory()) {
    if (stat.isFile()) {
      handlers.onFile({ path: relPath, size: stat.size });
    } else {
      // Sockets, FIFOs and devices: opening a FIFO for reading would block forever.
      handlers.onError(relPath, new Error("not a regular file"));
    }
    return;
  }

  const realPath = realpathSync(absPath);
  if (seen.has(realPath)) {
    handlers.onError(relPath, new Error(`symlink loop detected at ${relPath}`));
    return;
  }
  seen.add(realPath);

  let entries: string[];
  try {
    entries = readdirSync(absPath).sort();
  } catch (err) {
    seen.delete(realPath);
    handlers.onError(relPath, err as Error);
    return;
  }

  for (const entry of entries) {
    const childRel = relPath === "" ? entry : `${relPath}/${entry}`;
    if (handlers.shouldSkip?.(childRel)) continue;
    walk(join(absPath, entry), childRel, handlers, seen);
  }

  seen.delete(realPath);
}

/** Copies one file, creating the destination's parent directories as needed. */
export function copyInto(srcPath: string, destPath: string): void {
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}
