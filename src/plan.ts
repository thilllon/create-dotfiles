import { type Dirent, lstatSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { DotfilesConfig } from "./config";
import type { OutputFormat } from "./formats";
import { type PlanOptions, type ResolvedOptions, resolveOptions } from "./options";
import {
  compileExcludes,
  ENV_SCAN_MAX_DEPTH,
  ENV_SCAN_SKIPPED_FOLDERS,
  isEnvFile,
  isExcluded,
  type TargetGroup,
  type TargetPlatform,
  targetsFor,
} from "./targets";
import { type WalkedFile, walk } from "./walk";

/** `target` of files found by the home-directory `.env` scan rather than by a listed path. */
export const ENV_SCAN_TARGET = ".env scan";
export const CUSTOM_CATEGORY = "From ~/.dotfilesrc.toml";
export const CONFIG_ALL_CATEGORY = "Everything under ~/.config";

export interface PlannedFile {
  /** Home-relative path, `/` separated. */
  path: string;
  size: number;
  group: TargetGroup;
  /** The target entry that produced this file, e.g. `.config/nvim`. */
  target: string;
}

export interface FailedEntry {
  path: string;
  group: TargetGroup;
  error: string;
}

export interface FoundTarget {
  path: string;
  group: TargetGroup;
  category: string;
}

export interface MissingTarget {
  path: string;
  group: TargetGroup;
}

export interface PlanOutputs {
  folder?: string;
  zip?: string;
  tar?: string;
}

export interface Plan {
  /** `dotfiles-YYYYMMDD-HHMMSS` */
  name: string;
  homeDir: string;
  outDir: string;
  formats: OutputFormat[];
  includeEnv: boolean;
  includeConfig: boolean;
  maxFileSizeMb: number;
  config: DotfilesConfig;
  /** Whose default targets were attempted; see {@link PlanOptions.platform}. */
  platform: TargetPlatform;
  /** Files are staged here first; removed afterwards unless `folder` is a selected format. */
  stagingDir: string;
  outputs: PlanOutputs;
  /** The selected outputs, in folder/zip/tar order. */
  outputPaths: string[];
  /** Files that will be copied. */
  files: PlannedFile[];
  totalBytes: number;
  /** Files skipped because they exceed `maxFileSizeMb`. */
  tooLarge: PlannedFile[];
  /** Targets that do not exist on this machine. */
  missing: MissingTarget[];
  /** Targets that do exist, for the "found on this machine" listing. */
  found: FoundTarget[];
  /** Entries that could not be read (broken symlinks, symlink loops, sockets, ...). */
  failed: FailedEntry[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `dotfiles-YYYYMMDD-HHMMSS` in local time. */
export function collectionName(date: Date): string {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `dotfiles-${ymd}-${hms}`;
}

type ScanResult = Pick<Plan, "files" | "tooLarge" | "missing" | "found" | "failed">;

function enabledGroups(options: { includeEnv: boolean; includeConfig: boolean }): Set<TargetGroup> {
  const groups = new Set<TargetGroup>(["core", "custom"]);
  if (options.includeEnv) groups.add("secrets");
  if (options.includeConfig) groups.add("config-all");
  return groups;
}

/** True if the path exists at all, including a symlink whose target is gone. */
function entryExists(absPath: string): boolean {
  try {
    lstatSync(absPath);
    return true;
  } catch {
    return false;
  }
}

function byName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Finds `.env` / `.env.*` files at most {@link ENV_SCAN_MAX_DEPTH} levels below the home
 * directory. Excluded directories and the top-level {@link ENV_SCAN_SKIPPED_FOLDERS} are not
 * entered and symlinked directories are not followed, so the scan cannot wander into
 * `node_modules`, out of the home directory, or into folders macOS gates behind a permission
 * prompt.
 */
export function scanEnvFiles(
  homeDir: string,
  excluded: (relPath: string) => boolean,
  onFile: (file: WalkedFile) => void,
  onError: (relPath: string, error: Error) => void
): void {
  const visit = (absDir: string, relDir: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true }).sort(byName);
    } catch (err) {
      onError(relDir === "" ? "." : relDir, err as Error);
      return;
    }

    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (excluded(rel)) continue;

      // Real directories only: `isDirectory()` is false for symlinks and, on Windows, for
      // junctions and other reparse points (OneDrive placeholders, `My Documents`), which is
      // what keeps the scan inside the home directory and clear of EPERM. The top-level
      // ENV_SCAN_SKIPPED_FOLDERS are never listed either: on macOS that triggers "Terminal
      // would like to access" prompts. A symlinked `.env` file is still followed below.
      if (entry.isDirectory()) {
        const guarded = relDir === "" && ENV_SCAN_SKIPPED_FOLDERS.includes(entry.name);
        if (!guarded && depth + 1 < ENV_SCAN_MAX_DEPTH) {
          visit(join(absDir, entry.name), rel, depth + 1);
        }
      } else if (isEnvFile(entry.name)) {
        // A file the process may not stat (EPERM, EBUSY on a locked file) is reported and
        // skipped; nothing here can end the scan.
        try {
          const stat = statSync(join(absDir, entry.name));
          if (stat.isFile()) onFile({ path: rel, size: stat.size });
        } catch (err) {
          onError(rel, err as Error);
        }
      }
    }
  };

  visit(homeDir, "", 0);
}

function scan(resolved: ResolvedOptions): ScanResult {
  const { homeDir, config } = resolved;
  const maxBytes = resolved.maxFileSizeMb * 1024 * 1024;
  const rules = compileExcludes(config.exclude);
  const groups = enabledGroups(resolved);
  const result: ScanResult = { files: [], tooLarge: [], missing: [], found: [], failed: [] };
  const claimed = new Set<string>();
  const excluded = (relPath: string) => isExcluded(relPath, rules);

  const addFile = (file: WalkedFile, group: TargetGroup, target: string): void => {
    // A `.env` file is a secret wherever it turns up, so it is only ever copied with the
    // secrets group; this also keeps a plan filtered by group identical to a fresh plan.
    const effectiveGroup: TargetGroup = isEnvFile(posix.basename(file.path)) ? "secrets" : group;
    if (!groups.has(effectiveGroup) || claimed.has(file.path)) return;
    claimed.add(file.path);

    const planned: PlannedFile = { ...file, group: effectiveGroup, target };
    (file.size > maxBytes ? result.tooLarge : result.files).push(planned);
  };

  const addTarget = (path: string, group: TargetGroup, category: string): void => {
    if (!groups.has(group)) return;
    if (excluded(path)) {
      if (group === "custom") {
        result.failed.push({ path, group, error: "excluded: matches a never-copied rule" });
      }
      return;
    }

    const absPath = join(homeDir, path);
    if (!entryExists(absPath)) {
      result.missing.push({ path, group });
      return;
    }

    result.found.push({ path, group, category });
    walk(absPath, path, {
      onFile: (file) => addFile(file, group, path),
      onError: (relPath, error) =>
        result.failed.push({ path: relPath, group, error: error.message }),
      shouldSkip: excluded,
    });
  };

  const targets = targetsFor(resolved.platform);
  for (const spec of targets) {
    if (spec.group === "core") addTarget(spec.path, "core", spec.category);
  }
  for (const entry of config.include) {
    addTarget(entry, "custom", CUSTOM_CATEGORY);
  }
  for (const spec of targets) {
    if (spec.group === "secrets") addTarget(spec.path, "secrets", spec.category);
  }
  if (groups.has("secrets")) {
    scanEnvFiles(
      homeDir,
      excluded,
      (file) => addFile(file, "secrets", ENV_SCAN_TARGET),
      (relPath, error) =>
        result.failed.push({ path: relPath, group: "secrets", error: error.message })
    );
  }
  addTarget(".config", "config-all", CONFIG_ALL_CATEGORY);

  return result;
}

function buildPlan(scanResult: ScanResult, resolved: ResolvedOptions): Plan {
  const name = collectionName(resolved.now);
  const stagingDir = join(resolved.outDir, name);

  const outputs: PlanOutputs = {};
  if (resolved.formats.includes("folder")) outputs.folder = stagingDir;
  if (resolved.formats.includes("zip")) outputs.zip = join(resolved.outDir, `${name}.zip`);
  if (resolved.formats.includes("tar")) outputs.tar = join(resolved.outDir, `${name}.tar.gz`);

  return {
    name,
    homeDir: resolved.homeDir,
    outDir: resolved.outDir,
    formats: resolved.formats,
    includeEnv: resolved.includeEnv,
    includeConfig: resolved.includeConfig,
    maxFileSizeMb: resolved.maxFileSizeMb,
    config: resolved.config,
    platform: resolved.platform,
    stagingDir,
    outputs,
    outputPaths: [outputs.folder, outputs.zip, outputs.tar].filter(
      (path): path is string => path !== undefined
    ),
    ...scanResult,
    totalBytes: scanResult.files.reduce((sum, file) => sum + file.size, 0),
  };
}

/** Works out what would be collected and where it would go, without touching the disk. */
export function resolveTargets(options: PlanOptions = {}): Plan {
  const resolved = resolveOptions(options);
  return buildPlan(scan(resolved), resolved);
}

export type PlanOverrides = Pick<
  PlanOptions,
  "includeEnv" | "includeConfig" | "formats" | "outDir" | "now"
>;

/**
 * Narrows an existing plan to different groups, formats or output directory without scanning
 * again. Files, missing targets and failures are all filtered by group, so the result is the
 * same as a fresh plan made with those options.
 */
export function filterPlan(plan: Plan, overrides: PlanOverrides): Plan {
  const resolved = resolveOptions({
    homeDir: plan.homeDir,
    outDir: overrides.outDir ?? plan.outDir,
    includeEnv: overrides.includeEnv ?? plan.includeEnv,
    includeConfig: overrides.includeConfig ?? plan.includeConfig,
    formats: overrides.formats ?? plan.formats,
    maxFileSizeMb: plan.maxFileSizeMb,
    now: overrides.now,
    config: plan.config,
    platform: plan.platform,
  });
  const groups = enabledGroups(resolved);
  const keep = <T extends { group: TargetGroup }>(items: T[]): T[] =>
    items.filter((item) => groups.has(item.group));

  return buildPlan(
    {
      files: keep(plan.files),
      tooLarge: keep(plan.tooLarge),
      missing: keep(plan.missing),
      found: keep(plan.found),
      failed: keep(plan.failed),
    },
    resolved
  );
}
