import { sep } from "node:path";

/**
 * Every home-relative path is `/`-separated inside this package, whatever the host: target
 * lists, plan entries, summaries, restore listings and archive entry names all use `/`.
 * Conversion to the native form happens only at the filesystem boundary, where
 * `path.join(homeDir, posixPath)` accepts `/` on Windows as well; anything that comes back
 * from the filesystem with native separators is converted here before it is kept.
 */

const BACKSLASHES = /\\/g;

/**
 * Converts a native path to `/` separators. `separator` is the host's by default; pass
 * `path.win32.sep` to convert a Windows-style path on any host (tests do).
 */
export function toPosixPath(path: string, separator: string = sep): string {
  return separator === "/" ? path : path.split(separator).join("/");
}

/**
 * Turns every `\` into `/`. Used for user-written paths (config entries, `~\...`), which on
 * Windows are as likely to be spelled with backslashes as not.
 */
export function normalizeSlashes(path: string): string {
  return path.replace(BACKSLASHES, "/");
}

/**
 * The entry name of a collected file inside the zip or tar: `<collection name>/<posix path>`.
 * yazl throws on a backslash ("invalid characters in path"), and the tar is read with `/` on
 * every platform, so both get the `/` form even if the relative path arrived native.
 */
export function archiveEntryName(
  collectionName: string,
  relPath: string,
  separator: string = sep
): string {
  return `${collectionName}/${toPosixPath(relPath, separator)}`;
}

/**
 * Whether two resolved absolute paths name the same location. Windows paths compare
 * case-insensitively (`C:\Users\me` and `c:\users\me` are one directory); elsewhere the
 * comparison is exact.
 */
export function isSamePath(a: string, b: string, platform: string = process.platform): boolean {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
