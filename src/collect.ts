import { randomInt } from "node:crypto";
import { once } from "node:events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  type WriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, Readable, Writable } from "node:stream";
import { create as createTar } from "tar";
import { ZipFile } from "yazl";
import type { PlanOptions } from "./config";
import {
  AES_256_STRENGTH,
  GENERATED_PASSWORD_ALPHABET,
  GENERATED_PASSWORD_GROUP_LENGTH,
  GENERATED_PASSWORD_GROUPS,
  MAX_ZIP_PASSWORD_LENGTH,
  MIN_ZIP_PASSWORD_LENGTH,
  PRINTABLE_ASCII,
  RM_MAX_RETRIES,
  STAGING_TEMP_PREFIX,
  UNIX_PERMISSION_BITS,
  UTF8_BOM,
  ZIP_PASSWORD_ENV,
  ZIP_PASSWORD_FILE_ENV,
} from "./constants";
import { DotfileError } from "./errors";
import { PathUtils } from "./files";
import { type FailedEntry, type Plan, type PlannedFile, Planner } from "./plan";
import type { TargetGroup } from "./targets";

/**
 * A password, or a function that is called only when the zip is actually encrypted and
 * returns `undefined` when it has none to give (the interactive flow then asks for one).
 */
export type ZipPasswordSource = string | (() => string | undefined);

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

/** The zip password policy, the generator, and the environment readers for scripted runs. */
export class ZipPassword {
  /**
   * Why `password` cannot protect the zip, or `undefined` when it can. Only printable ASCII is
   * accepted because 7-Zip (p7zip in particular) rejects anything else, which would leave a zip
   * nobody can open with the most common tool.
   */
  static problem(password: string): string | undefined {
    if (password.length < MIN_ZIP_PASSWORD_LENGTH) {
      return `The zip password must be at least ${MIN_ZIP_PASSWORD_LENGTH} characters (got ${password.length})`;
    }
    if (password.length > MAX_ZIP_PASSWORD_LENGTH) {
      return `The zip password must be at most ${MAX_ZIP_PASSWORD_LENGTH} characters, the most 7-Zip accepts (got ${password.length})`;
    }
    if (!PRINTABLE_ASCII.test(password)) {
      return "The zip password may contain only printable ASCII: letters, digits, punctuation and spaces (7-Zip rejects other characters)";
    }
    return undefined;
  }

  static assert(password: string): void {
    const problem = ZipPassword.problem(password);
    if (problem !== undefined) {
      throw new DotfileError(problem);
    }
  }

  /** 30 random symbols in six dash-separated groups of five: 150 bits, e.g. `7K2QM-4XH9T-...`. */
  static generate(): string {
    const groups: string[] = [];
    for (let g = 0; g < GENERATED_PASSWORD_GROUPS; g++) {
      let group = "";
      for (let i = 0; i < GENERATED_PASSWORD_GROUP_LENGTH; i++) {
        group += GENERATED_PASSWORD_ALPHABET[randomInt(GENERATED_PASSWORD_ALPHABET.length)];
      }
      groups.push(group);
    }
    return groups.join("-");
  }

  /**
   * The password for a run without a terminal prompt: `$CREATE_DOTFILES_ZIP_PASSWORD`, or the
   * first line of the file named by `$CREATE_DOTFILES_ZIP_PASSWORD_FILE` (a leading UTF-8 BOM,
   * as Windows editors write, is dropped). An empty variable counts as unset. Returns
   * `undefined` when neither is set; setting both is an error.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const direct = env[ZIP_PASSWORD_ENV] || undefined;
    const file = env[ZIP_PASSWORD_FILE_ENV] || undefined;
    if (direct !== undefined && file !== undefined) {
      throw new DotfileError(`Set only one of ${ZIP_PASSWORD_ENV} and ${ZIP_PASSWORD_FILE_ENV}`);
    }
    if (file === undefined) {
      return direct;
    }

    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (err) {
      throw new DotfileError(
        `Cannot read ${ZIP_PASSWORD_FILE_ENV} (${file}): ${(err as Error).message}`
      );
    }
    const [line = ""] = content.replace(UTF8_BOM, "").split(/\r?\n/, 1);
    if (line === "") {
      throw new DotfileError(
        `${ZIP_PASSWORD_FILE_ENV} (${file}) has no password on its first line`
      );
    }
    return line;
  }

  /** {@link ZipPassword.fromEnv} for runs that cannot prompt: no password is an error. */
  static requireFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const password = ZipPassword.fromEnv(env);
    if (password === undefined) {
      throw new DotfileError(
        `Encrypting the zip needs a password: set ${ZIP_PASSWORD_ENV} or ${ZIP_PASSWORD_FILE_ENV}, or run interactively in a terminal to be asked for one`
      );
    }
    return password;
  }
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
export class Collector {
  constructor(
    private readonly plan: Plan,
    private readonly options: WriteOptions = {}
  ) {}

  /** Plans and writes in one step; the usual entry point. */
  static async collect(options: CollectOptions = {}): Promise<CollectSummary> {
    return new Collector(Planner.plan(options), options).write();
  }

  static countByGroup(files: readonly { group: TargetGroup }[]): GroupCounts {
    const counts: GroupCounts = { core: 0, secrets: 0, "config-all": 0, custom: 0 };
    for (const file of files) {
      counts[file.group] += 1;
    }
    return counts;
  }

  async write(): Promise<CollectSummary> {
    const { plan, options } = this;
    const zipPassword = this.zipPassword();
    if (options.dryRun) {
      return this.summarize(plan.files, plan.failed, [], true);
    }

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
      ? mkdtempSync(join(tmpdir(), STAGING_TEMP_PREFIX))
      : plan.outDir;
    const stagingDir = join(stagingRoot, plan.name);
    mkdirSync(stagingDir, { recursive: true });
    try {
      plan.files.forEach((file, index) => {
        try {
          PathUtils.copyInto(join(plan.homeDir, file.path), join(stagingDir, file.path));
          copied.push(file);
        } catch (err) {
          failed.push({ path: file.path, group: file.group, error: (err as Error).message });
        }
        options.onProgress?.({ done: index + 1, total: plan.files.length, file, stagingDir });
      });

      if (keepFolder) {
        written.push(stagingDir);
      }
      if (plan.outputs.zip !== undefined) {
        if (zipPassword === undefined) {
          await this.writePlainZip(stagingDir, copied, plan.outputs.zip);
        } else {
          await this.writeEncryptedZip(stagingDir, copied, plan.outputs.zip, zipPassword);
        }
        written.push(plan.outputs.zip);
      }
      if (plan.outputs.tar !== undefined) {
        await this.writeTar(stagingRoot, plan.outputs.tar);
        written.push(plan.outputs.tar);
      }
    } finally {
      if (!keepFolder) {
        rmSync(privateStaging ? stagingRoot : stagingDir, {
          recursive: true,
          force: true,
          maxRetries: RM_MAX_RETRIES,
        });
      }
    }

    return this.summarize(copied, failed, written, false);
  }

  private summarize(
    copied: PlannedFile[],
    failed: FailedEntry[],
    written: string[],
    dryRun: boolean
  ): CollectSummary {
    return {
      ...this.plan,
      dryRun,
      copied,
      copiedBytes: copied.reduce((sum, file) => sum + file.size, 0),
      counts: Collector.countByGroup(copied),
      failed,
      written,
    };
  }

  /**
   * Settles the zip password before anything is written. In a dry run nothing is encrypted, so
   * a deferred source is not asked; a string is still checked, so a bad one fails early.
   */
  private zipPassword(): string | undefined {
    const source = this.options.zipPassword;
    if (!this.plan.encryptZip) {
      if (typeof source === "string") {
        throw new DotfileError(
          "A zip password was given, but the zip is not encrypted (set encryptZip, or --encrypt-zip)"
        );
      }
      return undefined;
    }
    if (this.options.dryRun && typeof source !== "string") {
      return undefined;
    }

    const password = typeof source === "function" ? source() : source;
    if (password === undefined) {
      throw new DotfileError("Encrypting the zip needs a password (zipPassword)");
    }
    ZipPassword.assert(password);
    return password;
  }

  /**
   * Zips the staged copies so the archive holds exactly what the folder holds. Resolves only
   * once the zip file is flushed and closed, so the summary never names an incomplete archive.
   *
   * yazl reports an unreadable entry on the ZipFile itself, never on `outputStream`; without a
   * listener there it is an uncaught exception. On any failure both streams are destroyed, which
   * stops yazl from opening further staged files while the caller is cleaning up, and the
   * partial archive is removed.
   */
  private async writePlainZip(
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
          zip.addFile(
            join(stagingDir, file.path),
            PathUtils.archiveEntryName(this.plan.name, file.path)
          );
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
   * zip.js is loaded only here, from the sub-path that leaves out its own deflate and worker
   * code in favour of Node's CompressionStream; the bundle keeps it in a separate chunk, so runs
   * that do not encrypt never load it. The sub-path is ESM-only, which a dynamic import handles
   * both in the bundle and under tsx.
   */
  private async writeEncryptedZip(
    stagingDir: string,
    files: readonly PlannedFile[],
    zipPath: string,
    password: string
  ): Promise<void> {
    const { ZipWriter } = await import("@zip.js/zip.js/lib/zip-core-custom.js");
    const out = createWriteStream(zipPath);
    const zip = new ZipWriter(Writable.toWeb(out), {
      password,
      encryptionStrength: AES_256_STRENGTH,
      zipCrypto: false,
      useWebWorkers: false,
    });

    try {
      for (const file of files) {
        const source = join(stagingDir, file.path);
        const stat = statSync(source);
        await zip.add(
          PathUtils.archiveEntryName(this.plan.name, file.path),
          { readable: Readable.toWeb(createReadStream(source)), size: stat.size },
          { lastModDate: stat.mtime, unixMode: stat.mode & UNIX_PERMISSION_BITS }
        );
      }
      await zip.close();
      if (!out.closed) {
        await once(out, "close");
      }
    } catch (err) {
      await discardOutput(out, zipPath);
      throw err;
    }
  }

  /**
   * Tars the staged folder; a failed attempt does not leave a partial archive behind. tar walks
   * the folder itself and writes `/`-separated entry names on every platform, so the tar always
   * mirrors the folder layout (and therefore the zip). `stagingRoot` holds the staged folder.
   */
  private async writeTar(stagingRoot: string, tarPath: string): Promise<void> {
    try {
      await createTar({ gzip: true, file: tarPath, cwd: stagingRoot, portable: true }, [
        this.plan.name,
      ]);
    } catch (err) {
      rmSync(tarPath, { force: true });
      throw err;
    }
  }
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
