import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { create as createTar } from "tar";
import { ZipFile } from "yazl";
import { DotfileError } from "./errors";
import type { PlanOptions } from "./options";
import { type FailedEntry, type Plan, type PlannedFile, resolveTargets } from "./plan";
import type { TargetGroup } from "./targets";
import { copyInto } from "./walk";

export interface CollectProgress {
  /** Files attempted so far, including this one. */
  done: number;
  total: number;
  file: PlannedFile;
}

export interface WriteOptions {
  /** Plan and report only; nothing is written. */
  dryRun?: boolean;
  /** Called after each file is attempted. */
  onProgress?: (progress: CollectProgress) => void;
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

/** Zips the staged copies so the archive holds exactly what the folder holds. */
function writeZip(plan: Plan, files: readonly PlannedFile[], zipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const file of files) {
      zip.addFile(join(plan.stagingDir, file.path), `${plan.name}/${file.path}`);
    }

    const out = createWriteStream(zipPath);
    out.once("close", () => resolve());
    out.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}

/** Plans and writes in one step; the usual entry point. */
export async function collect(options: CollectOptions = {}): Promise<CollectSummary> {
  return writePlan(resolveTargets(options), options);
}

/**
 * Writes a plan: files are staged into `plan.stagingDir`, archives are built from the staged
 * copies, and the staging folder is removed afterwards unless `folder` is a selected format.
 */
export async function writePlan(plan: Plan, options: WriteOptions = {}): Promise<CollectSummary> {
  if (options.dryRun) return summarize(plan, plan.files, plan.failed, [], true);

  for (const path of new Set([plan.stagingDir, ...plan.outputPaths])) {
    if (existsSync(path)) {
      throw new DotfileError(`Output already exists: ${path} (wait a second and run again)`);
    }
  }

  const keepFolder = plan.outputs.folder !== undefined;
  const copied: PlannedFile[] = [];
  const failed: FailedEntry[] = [...plan.failed];
  const written: string[] = [];

  mkdirSync(plan.stagingDir, { recursive: true });
  try {
    plan.files.forEach((file, index) => {
      try {
        copyInto(join(plan.homeDir, file.path), join(plan.stagingDir, file.path));
        copied.push(file);
      } catch (err) {
        failed.push({ path: file.path, group: file.group, error: (err as Error).message });
      }
      options.onProgress?.({ done: index + 1, total: plan.files.length, file });
    });

    if (keepFolder) written.push(plan.stagingDir);
    if (plan.outputs.zip !== undefined) {
      await writeZip(plan, copied, plan.outputs.zip);
      written.push(plan.outputs.zip);
    }
    if (plan.outputs.tar !== undefined) {
      await createTar({ gzip: true, file: plan.outputs.tar, cwd: plan.outDir, portable: true }, [
        plan.name,
      ]);
      written.push(plan.outputs.tar);
    }
  } finally {
    if (!keepFolder) rmSync(plan.stagingDir, { recursive: true, force: true });
  }

  return summarize(plan, copied, failed, written, false);
}
