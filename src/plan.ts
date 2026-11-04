import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import {
  type DotfilesConfig,
  type OutputFormat,
  Options,
  type PlanOptions,
  type ResolvedOptions,
} from "./config";
import {
  BYTES_PER_MB,
  COLLECTION_NAME_PREFIX,
  CONFIG_ALL_CATEGORY,
  CONFIG_DIR,
  CUSTOM_CATEGORY,
  ENV_SCAN_MAX_DEPTH,
  ENV_SCAN_SKIPPED_FOLDERS,
  ENV_SCAN_TARGET,
} from "./constants";
import { FileWalker, PathUtils, type WalkedFile } from "./files";
import { ExcludeRules, type TargetGroup, type TargetPlatform, Targets } from "./targets";

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
  /** Whether the zip is encrypted (AES-256); only ever true when a zip is written. */
  encryptZip: boolean;
  includeEnv: boolean;
  includeConfig: boolean;
  maxFileSizeMb: number;
  config: DotfilesConfig;
  /** Whose default targets were attempted; see {@link PlanOptions.platform}. */
  platform: TargetPlatform;
  /**
   * The collection folder. Files are staged here first and it is removed afterwards unless
   * `folder` is a selected format; an encrypted zip without the folder is staged in a private
   * temporary directory instead (see `Collector`).
   */
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

export type PlanOverrides = Pick<
  PlanOptions,
  "includeEnv" | "includeConfig" | "formats" | "encryptZip" | "outDir" | "now"
>;

type ScanResult = Pick<Plan, "files" | "tooLarge" | "missing" | "found" | "failed">;

const pad = (n: number) => String(n).padStart(2, "0");

function enabledGroups(options: { includeEnv: boolean; includeConfig: boolean }): Set<TargetGroup> {
  const groups = new Set<TargetGroup>(["core", "custom"]);
  if (options.includeEnv) {
    groups.add("secrets");
  }
  if (options.includeConfig) {
    groups.add("config-all");
  }
  return groups;
}

function byName(a: Dirent, b: Dirent): number {
  if (a.name < b.name) {
    return -1;
  }
  return a.name > b.name ? 1 : 0;
}

/** Works out what would be collected and where it would go, without writing anything. */
export class Planner {
  /** Scans the home directory and builds the plan. */
  static plan(options: PlanOptions = {}): Plan {
    const resolved = Options.resolve(options);
    return Planner.build(new HomeScan(resolved).run(), resolved);
  }

  /**
   * Narrows an existing plan to different groups, formats or output directory without scanning
   * again. Files, missing targets and failures are all filtered by group, so the result is the
   * same as a fresh plan made with those options. Without an `encryptZip` override a plan that
   * wrote a zip keeps its own choice for as long as it still does; one that wrote none leaves it
   * to the config's `encrypt_zip`, as a fresh plan would.
   */
  static filter(plan: Plan, overrides: PlanOverrides): Plan {
    const formats = overrides.formats ?? plan.formats;
    const resolved = Options.resolve({
      homeDir: plan.homeDir,
      outDir: overrides.outDir ?? plan.outDir,
      includeEnv: overrides.includeEnv ?? plan.includeEnv,
      includeConfig: overrides.includeConfig ?? plan.includeConfig,
      formats,
      encryptZip:
        overrides.encryptZip ??
        (plan.formats.includes("zip") ? formats.includes("zip") && plan.encryptZip : undefined),
      maxFileSizeMb: plan.maxFileSizeMb,
      now: overrides.now,
      config: plan.config,
      platform: plan.platform,
    });
    const groups = enabledGroups(resolved);
    const keep = <T extends { group: TargetGroup }>(items: T[]): T[] =>
      items.filter((item) => groups.has(item.group));

    return Planner.build(
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

  /** `dotfiles-YYYYMMDD-HHMMSS` in local time. */
  static collectionName(date: Date): string {
    const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const hms = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `${COLLECTION_NAME_PREFIX}${ymd}-${hms}`;
  }

  /**
   * Finds `.env` / `.env.*` files at most {@link ENV_SCAN_MAX_DEPTH} levels below the home
   * directory. Excluded directories and the top-level {@link ENV_SCAN_SKIPPED_FOLDERS} are not
   * entered and symlinked directories are not followed, so the scan cannot wander into
   * `node_modules`, out of the home directory, or into folders macOS gates behind a permission
   * prompt.
   */
  static scanEnvFiles(
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
        if (excluded(rel)) {
          continue;
        }

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
        } else if (Targets.isEnvFile(entry.name)) {
          // A file the process may not stat (EPERM, EBUSY on a locked file) is reported and
          // skipped; nothing here can end the scan.
          try {
            const stat = statSync(join(absDir, entry.name));
            if (stat.isFile()) {
              onFile({ path: rel, size: stat.size });
            }
          } catch (err) {
            onError(rel, err as Error);
          }
        }
      }
    };

    visit(homeDir, "", 0);
  }

  private static build(scanResult: ScanResult, resolved: ResolvedOptions): Plan {
    const name = Planner.collectionName(resolved.now);
    const stagingDir = join(resolved.outDir, name);

    const outputs: PlanOutputs = {};
    if (resolved.formats.includes("folder")) {
      outputs.folder = stagingDir;
    }
    if (resolved.formats.includes("zip")) {
      outputs.zip = join(resolved.outDir, `${name}.zip`);
    }
    if (resolved.formats.includes("tar")) {
      outputs.tar = join(resolved.outDir, `${name}.tar.gz`);
    }

    return {
      name,
      homeDir: resolved.homeDir,
      outDir: resolved.outDir,
      formats: resolved.formats,
      encryptZip: resolved.encryptZip,
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
}

/** One pass over the home directory: every enabled target, then the `.env` scan. */
class HomeScan {
  private readonly maxBytes: number;
  private readonly rules: ExcludeRules;
  private readonly groups: Set<TargetGroup>;
  private readonly claimed = new Set<string>();
  private readonly result: ScanResult = {
    files: [],
    tooLarge: [],
    missing: [],
    found: [],
    failed: [],
  };

  constructor(private readonly resolved: ResolvedOptions) {
    this.maxBytes = resolved.maxFileSizeMb * BYTES_PER_MB;
    this.rules = new ExcludeRules(resolved.config.exclude);
    this.groups = enabledGroups(resolved);
  }

  run(): ScanResult {
    const targets = Targets.forPlatform(this.resolved.platform);
    for (const spec of targets) {
      if (spec.group === "core") {
        this.addTarget(spec.path, "core", spec.category);
      }
    }
    for (const entry of this.resolved.config.include) {
      this.addTarget(entry, "custom", CUSTOM_CATEGORY);
    }
    for (const spec of targets) {
      if (spec.group === "secrets") {
        this.addTarget(spec.path, "secrets", spec.category);
      }
    }
    if (this.groups.has("secrets")) {
      Planner.scanEnvFiles(
        this.resolved.homeDir,
        this.excluded,
        (file) => this.addFile(file, "secrets", ENV_SCAN_TARGET),
        (relPath, error) =>
          this.result.failed.push({ path: relPath, group: "secrets", error: error.message })
      );
    }
    this.addTarget(CONFIG_DIR, "config-all", CONFIG_ALL_CATEGORY);

    return this.result;
  }

  private readonly excluded = (relPath: string): boolean => this.rules.matches(relPath);

  private addFile(file: WalkedFile, group: TargetGroup, target: string): void {
    // A `.env` file is a secret wherever it turns up, so it is only ever copied with the
    // secrets group; this also keeps a plan filtered by group identical to a fresh plan.
    const effectiveGroup: TargetGroup = Targets.isEnvFile(posix.basename(file.path))
      ? "secrets"
      : group;
    if (!this.groups.has(effectiveGroup) || this.claimed.has(file.path)) {
      return;
    }
    this.claimed.add(file.path);

    const planned: PlannedFile = { ...file, group: effectiveGroup, target };
    (file.size > this.maxBytes ? this.result.tooLarge : this.result.files).push(planned);
  }

  private addTarget(path: string, group: TargetGroup, category: string): void {
    if (!this.groups.has(group)) {
      return;
    }
    if (this.excluded(path)) {
      if (group === "custom") {
        this.result.failed.push({ path, group, error: "excluded: matches a never-copied rule" });
      }
      return;
    }

    const absPath = join(this.resolved.homeDir, path);
    if (!PathUtils.entryExists(absPath)) {
      this.result.missing.push({ path, group });
      return;
    }

    this.result.found.push({ path, group, category });
    new FileWalker({
      onFile: (file) => this.addFile(file, group, path),
      onError: (relPath, error) =>
        this.result.failed.push({ path: relPath, group, error: error.message }),
      shouldSkip: this.excluded,
    }).walk(absPath, path);
  }
}
