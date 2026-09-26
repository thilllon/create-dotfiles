import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  type WriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, Readable, Writable } from "node:stream";
import { create as createTar } from "tar";
import { ZipFile } from "yazl";
import { DotfileError } from "./errors";
import type { PlanOptions } from "./options";
import { archiveEntryName } from "./paths";
import { type FailedEntry, type Plan, type PlannedFile, resolveTargets } from "./plan";
import type { TargetGroup } from "./targets";
import { copyInto } from "./walk";
import { assertZipPassword, type ZipPasswordSource } from "./zip-password";

export interface CollectProgress {
  /** Files attempted so far, including this one. */
  done: number;
  total: number;
  file: PlannedFile;
  /**
   * Where the copies are being made: `plan.stagingDir`, except for an encrypted zip without the
   * folder among the outputs, which is staged in a private temporary directory instead.
   */
  stagingDir: string;
}

export interface WriteOptions {
  /** Plan and report only; nothing is written. */
  dryRun?: boolean;
  /** Called after each file is attempted. */
  onProgress?: (progress: CollectProgress) => void;
  /**
   * The password for an encrypted zip (`encryptZip`). A function is called only when the zip
   * is actually written encrypted, so a caller can defer reading a secret. A string given for
   * a plan that does not encrypt is an error rather than a silently unprotected zip.
   */
  zipPassword?: ZipPasswordSource;
}

export interface CollectOptions extends PlanOptions, WriteOptions {}

export type GroupCounts = Record<TargetGroup, number>;

export interface CollectSummary extends Plan {
  dryRun: boolean;
  /** Files copied (in a dry run: the files that would be). */
  copied: PlannedFile[];
  copiedBytes: number;
  /** Copied files per group. */
  counts: GroupCounts;
  /** Output paths that now exist; empty in a dry run. */
  written: string[];
}

export function countByGroup(files: readonly { group: TargetGroup }[]): GroupCounts {
  const counts: GroupCounts = { core: 0, secrets: 0, "config-all": 0, custom: 0 };
  for (const file of files) counts[file.group] += 1;
  return counts;
}

function summarize(
  plan: Plan,
  copied: PlannedFile[],
  failed: FailedEntry[],
  written: string[],
  dryRun: boolean
): CollectSummary {
  return {
    ...plan,
    dryRun,
    copied,
    copiedBytes: copied.reduce((sum, file) => sum + file.size, 0),
    counts: countByGroup(copied),
    failed,
    written,
  };
}

/**
 * Tears down the output of a failed archive and removes the file.
 *
 * The removal waits for the file stream to close first. `createWriteStream` opens the file
 * asynchronously, so an error that arrives before the open completes would otherwise be followed
 * by the open creating the file after `rmSync` ran, leaving an empty archive behind (seen
 * intermittently in CI). Node emits 'close' after `destroy()` even when the open is still pending.
 *
 * Destroying the stream while a write is still in flight makes it emit ERR_STREAM_DESTROYED just
 * before 'close'. That follow-on error is ignored: waiting on it would skip the removal, and it
 * would replace the error that actually failed the archive (the file that could not be read).
 */
async function discardOutput(out: WriteStream, path: string): Promise<void> {
  if (!out.closed) {
    out.on("error", () => {});
    const closed = new Promise<void>((resolve) => out.once("close", () => resolve()));
    out.destroy();
    await closed;
  }
  rmSync(path, { force: true });
}

/**
 * Zips the staged copies so the archive holds exactly what the folder holds. Resolves only
 * once the zip file is flushed and closed, so the summary never names an incomplete archive.
 *
 * yazl reports an unreadable entry on the ZipFile itself, never on `outputStream`; without a
 * listener there it is an uncaught exception. On any failure both streams are destroyed, which
 * stops yazl from opening further staged files while the caller is cleaning up, and the partial
 * archive is removed.
 */
async function writePlainZip(
  plan: Plan,
  stagingDir: string,
  files: readonly PlannedFile[],
  zipPath: string
): Promise<void> {
  const zip = new ZipFile();
  // yazl types outputStream as the bare interface; it is a PassThrough, which can be destroyed.
  const source = zip.outputStream as Readable;
  const out = createWriteStream(zipPath);

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      for (const file of files) {
        zip.addFile(join(stagingDir, file.path), archiveEntryName(plan.name, file.path));
      }
      pipeline(source, out, (err) => (err ? reject(err) : resolve()));
      zip.end();
    });
  } catch (err) {
    source.destroy();
    await discardOutput(out, zipPath);
    throw err;
  }
}

/**
 * Zips the staged copies with WinZip AES-256 in its AE-2 form: every entry's contents are
 * encrypted (AES-CTR) and authenticated (HMAC-SHA1), and the CRC is stored as 0 so it cannot
 * reveal the contents of a small file. File names, sizes and dates stay readable, as in any
 * zip. yazl cannot write encrypted entries, hence zip.js here.
 *
 * Entries are added one at a time from a stream with an explicit size: concurrent adds are
 * buffered in memory by zip.js, and `fs.openAsBlob` misreports sizes over 4 GiB. A failed
 * attempt removes the partial archive, as for the plain zip.
 *
 * zip.js is loaded only here, from the sub-path that leaves out its own deflate and worker code
 * in favour of Node's CompressionStream; the bundle keeps it in a separate chunk, so runs that
 * do not encrypt never load it. The sub-path is ESM-only, which a dynamic import handles both
 * in the bundle and under tsx.
 */
async function writeEncryptedZip(
  plan: Plan,
  stagingDir: string,
  files: readonly PlannedFile[],
  zipPath: string,
  password: string
): Promise<void> {
  const { ZipWriter } = await import("@zip.js/zip.js/lib/zip-core-custom.js");
  const out = createWriteStream(zipPath);
  const zip = new ZipWriter(Writable.toWeb(out), {
    password,
    encryptionStrength: 3,
    zipCrypto: false,
    useWebWorkers: false,
  });

  try {
    for (const file of files) {
      const source = join(stagingDir, file.path);
      const stat = statSync(source);
      await zip.add(
        archiveEntryName(plan.name, file.path),
        { readable: Readable.toWeb(createReadStream(source)), size: stat.size },
        { lastModDate: stat.mtime, unixMode: stat.mode & 0o7777 }
      );
    }
    await zip.close();
    if (!out.closed) await once(out, "close");
  } catch (err) {
    await discardOutput(out, zipPath);
    throw err;
  }
}

/**
 * Settles the zip password before anything is written. In a dry run nothing is encrypted, so a
 * deferred source is not asked; a string is still checked, so a bad one fails early.
 */
function zipPasswordFor(plan: Plan, options: WriteOptions): string | undefined {
  const source = options.zipPassword;
  if (!plan.encryptZip) {
    if (typeof source === "string") {
      throw new DotfileError(
        "A zip password was given, but the zip is not encrypted (set encryptZip, or --encrypt-zip)"
      );
    }
    return undefined;
  }
  if (options.dryRun && typeof source !== "string") return undefined;

  const password = typeof source === "function" ? source() : source;
  if (password === undefined) {
    throw new DotfileError("Encrypting the zip needs a password (zipPassword)");
  }
  assertZipPassword(password);
  return password;
}

/**
 * Tars the staged folder; a failed attempt does not leave a partial archive behind. tar walks
 * the folder itself and writes `/`-separated entry names on every platform, so the tar always
 * mirrors the folder layout (and therefore the zip). `stagingRoot` holds the staged folder.
 */
async function writeTar(plan: Plan, stagingRoot: string, tarPath: string): Promise<void> {
  try {
    await createTar({ gzip: true, file: tarPath, cwd: stagingRoot, portable: true }, [plan.name]);
  } catch (err) {
    rmSync(tarPath, { force: true });
    throw err;
  }
}

/** Plans and writes in one step; the usual entry point. */
export async function collect(options: CollectOptions = {}): Promise<CollectSummary> {
  return writePlan(resolveTargets(options), options);
}

/**
 * Writes a plan: files are staged into `plan.stagingDir`, archives are built from the staged
 * copies, and the staging folder is removed afterwards unless `folder` is a selected format.
 * An encrypted zip's password is settled first, so a missing or weak one writes nothing.
 *
 * An encrypted zip without the folder among the outputs is staged in a private temporary
 * directory instead (created 0700 under the OS temp dir). Staged next to the zip, the plaintext
 * copies would land on whatever medium the output goes to: a synced folder uploads them, a USB
 * stick keeps them recoverable after deletion, and an interrupted run leaves them behind.
 */
export async function writePlan(plan: Plan, options: WriteOptions = {}): Promise<CollectSummary> {
  const zipPassword = zipPasswordFor(plan, options);
  if (options.dryRun) return summarize(plan, plan.files, plan.failed, [], true);

  for (const path of new Set([plan.stagingDir, ...plan.outputPaths])) {
    if (existsSync(path)) {
      throw new DotfileError(`Output already exists: ${path} (wait a second and run again)`);
    }
  }

  const keepFolder = plan.outputs.folder !== undefined;
  const privateStaging = !keepFolder && zipPassword !== undefined;
  const copied: PlannedFile[] = [];
  const failed: FailedEntry[] = [...plan.failed];
  const written: string[] = [];

  mkdirSync(plan.outDir, { recursive: true });
  const stagingRoot = privateStaging
    ? mkdtempSync(join(tmpdir(), "create-dotfiles-"))
    : plan.outDir;
  const stagingDir = join(stagingRoot, plan.name);
  mkdirSync(stagingDir, { recursive: true });
  try {
    plan.files.forEach((file, index) => {
      try {
        copyInto(join(plan.homeDir, file.path), join(stagingDir, file.path));
        copied.push(file);
      } catch (err) {
        failed.push({ path: file.path, group: file.group, error: (err as Error).message });
      }
      options.onProgress?.({ done: index + 1, total: plan.files.length, file, stagingDir });
    });

    if (keepFolder) written.push(stagingDir);
    if (plan.outputs.zip !== undefined) {
      if (zipPassword === undefined)
        await writePlainZip(plan, stagingDir, copied, plan.outputs.zip);
      else await writeEncryptedZip(plan, stagingDir, copied, plan.outputs.zip, zipPassword);
      written.push(plan.outputs.zip);
    }
    if (plan.outputs.tar !== undefined) {
      await writeTar(plan, stagingRoot, plan.outputs.tar);
      written.push(plan.outputs.tar);
    }
  } finally {
    // Retries cover Windows, where an archiver or indexer may still hold a staged file open.
    if (!keepFolder) {
      rmSync(privateStaging ? stagingRoot : stagingDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }

  return summarize(plan, copied, failed, written, false);
}
