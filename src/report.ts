import type { CollectSummary } from "./collect";
import type { FoundTarget, PlannedFile } from "./plan";
import type { RestoreSummary } from "./restore";
import {
  ENV_SCAN_MAX_DEPTH,
  ENV_SCAN_SKIPPED_FOLDERS,
  HARD_EXCLUDED_DIR_NAMES,
  type TargetGroup,
} from "./targets";

const GROUP_ORDER: readonly TargetGroup[] = ["core", "custom", "secrets", "config-all"];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function fileLines(files: readonly PlannedFile[]): string[] {
  return files.map((file) => `  ${file.path} (${formatBytes(file.size)}) [${file.group}]`);
}

function outputLines(summary: CollectSummary): string[] {
  const lines: string[] = [];
  if (summary.outputs.folder !== undefined) lines.push(`  folder: ${summary.outputs.folder}/`);
  if (summary.outputs.zip !== undefined) lines.push(`  zip:    ${summary.outputs.zip}`);
  if (summary.outputs.tar !== undefined) lines.push(`  tar.gz: ${summary.outputs.tar}`);
  return lines;
}

/**
 * The end-of-run report. A dry run always lists every file; a real run lists them only with
 * `listFiles` (the interactive flow shows counts, `--auto` shows the list).
 */
export function formatSummary(
  summary: CollectSummary,
  options: { listFiles?: boolean } = {}
): string {
  const listFiles = options.listFiles ?? summary.dryRun;
  const lines: string[] = [];

  const verb = summary.dryRun ? "Would copy" : "Copied";
  lines.push(
    `${verb} ${plural(summary.copied.length, "file")} (${formatBytes(summary.copiedBytes)}) from ${summary.homeDir}`
  );
  if (listFiles) lines.push(...fileLines(summary.copied));

  lines.push(`Per group: ${GROUP_ORDER.map((g) => `${g} ${summary.counts[g]}`).join(", ")}`);

  if (summary.tooLarge.length > 0) {
    lines.push(`Skipped, larger than ${summary.maxFileSizeMb} MB (${summary.tooLarge.length}):`);
    lines.push(...summary.tooLarge.map((file) => `  ${file.path} (${formatBytes(file.size)})`));
  }
  if (summary.missing.length > 0) {
    lines.push(
      `Not found (${summary.missing.length}): ${summary.missing.map((m) => m.path).join(", ")}`
    );
  }
  if (summary.failed.length > 0) {
    lines.push(`Failed (${summary.failed.length}):`);
    lines.push(...summary.failed.map((entry) => `  ${entry.path}: ${entry.error}`));
  }

  lines.push(summary.dryRun ? "Would write:" : "Written:");
  lines.push(...outputLines(summary));
  if (summary.dryRun) lines.push("Dry run: nothing was written.");

  return lines.join("\n");
}

export function formatRestoreSummary(summary: RestoreSummary): string {
  const lines = [`Restoring ${summary.source} into ${summary.homeDir}`];
  lines.push(...summary.restored.map((path) => `  [OK] ${path}`));
  lines.push(...summary.skipped.map((path) => `  [SKIP] ${path} exists (use --force)`));
  lines.push(...summary.failed.map((entry) => `  [FAIL] ${entry.path}: ${entry.error}`));
  lines.push(
    `Restored ${plural(summary.restored.length, "file")}, ${summary.skipped.length} skipped, ${summary.failed.length} failed.`
  );
  return lines.join("\n");
}

/** Compact, category-grouped listing for the interactive "found on this machine" note. */
export function formatFoundTargets(found: readonly FoundTarget[]): string {
  if (found.length === 0) return "No dotfiles from the default list were found.";

  const byCategory = new Map<string, string[]>();
  for (const target of found) {
    const paths = byCategory.get(target.category) ?? [];
    paths.push(target.path);
    byCategory.set(target.category, paths);
  }
  return [...byCategory].map(([category, paths]) => `${category}: ${paths.join(", ")}`).join("\n");
}

/** The rules that apply no matter which options are chosen; shown in the intro and --help. */
export function formatNeverCopied(maxFileSizeMb: number): string {
  return [
    `Directories named ${HARD_EXCLUDED_DIR_NAMES.join(", ")}`,
    "~/Library/Caches and ~/Library/Application Support/*/Cache*",
    "SSH private keys: everything in ~/.ssh except config and *.pub",
    "GPG private keys: ~/.gnupg/private-keys-v1.d, *.gpg and *.kbx",
    `Files larger than ${maxFileSizeMb} MB`,
    ".env files and other secrets unless you opt in (--include-env)",
    `The .env scan looks ${ENV_SCAN_MAX_DEPTH} levels deep and never enters ${ENV_SCAN_SKIPPED_FOLDERS.map((name) => `~/${name}`).join(", ")}`,
  ].join("\n");
}
