import type { CollectSummary } from "./collect";
import {
  BYTE_UNITS,
  BYTES_PER_KB,
  ENV_SCAN_MAX_DEPTH,
  ENV_SCAN_SKIPPED_FOLDERS,
  GROUP_ORDER,
  HARD_EXCLUDED_DIR_NAMES,
  ZIP_PROTECTION_LABEL,
} from "./constants";
import type { FoundTarget, Plan, PlannedFile } from "./plan";
import type { RestoreSummary } from "./restore";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The text the CLI and the interactive flow print. */
export class Reporter {
  static bytes(bytes: number): string {
    if (bytes < BYTES_PER_KB) {
      return `${bytes} B`;
    }

    let value = bytes / BYTES_PER_KB;
    let unit = 0;
    while (value >= BYTES_PER_KB && unit < BYTE_UNITS.length - 1) {
      value /= BYTES_PER_KB;
      unit += 1;
    }
    return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
  }

  /**
   * With an encrypted zip, a folder or tar.gz written in the same run holds the same files in
   * the clear; say so, so nobody mistakes the whole run for protected. `undefined` otherwise.
   */
  static encryptionNote(plan: Pick<Plan, "encryptZip" | "outputs">): string | undefined {
    if (!plan.encryptZip) {
      return undefined;
    }
    const clear = [
      plan.outputs.folder !== undefined ? "folder" : undefined,
      plan.outputs.tar !== undefined ? "tar.gz" : undefined,
    ].filter((name): name is string => name !== undefined);
    if (clear.length === 0) {
      return undefined;
    }
    const subject = clear.length === 1 ? `the ${clear[0]} is` : `the ${clear.join(" and ")} are`;
    return `Only the zip is encrypted: ${subject} not.`;
  }

  /**
   * The output paths of a plan, one per line (`folder: ...`, `zip: ...`, `tar.gz: ...`),
   * followed by the encryption note when there is one. `indent` prefixes each path line.
   */
  static outputLines(plan: Pick<Plan, "encryptZip" | "outputs">, indent = ""): string[] {
    const lines: string[] = [];
    if (plan.outputs.folder !== undefined) {
      lines.push(`${indent}folder: ${plan.outputs.folder}/`);
    }
    if (plan.outputs.zip !== undefined) {
      const protection = plan.encryptZip ? ZIP_PROTECTION_LABEL : "";
      lines.push(`${indent}zip:    ${plan.outputs.zip}${protection}`);
    }
    if (plan.outputs.tar !== undefined) {
      lines.push(`${indent}tar.gz: ${plan.outputs.tar}`);
    }
    const note = Reporter.encryptionNote(plan);
    if (note !== undefined) {
      lines.push(note);
    }
    return lines;
  }

  /**
   * The end-of-run report. A dry run always lists every file; a real run lists them only with
   * `listFiles` (the interactive flow shows counts, `--auto` shows the list).
   */
  static summary(summary: CollectSummary, options: { listFiles?: boolean } = {}): string {
    const listFiles = options.listFiles ?? summary.dryRun;
    const lines: string[] = [];

    const verb = summary.dryRun ? "Would copy" : "Copied";
    lines.push(
      `${verb} ${plural(summary.copied.length, "file")} (${Reporter.bytes(summary.copiedBytes)}) from ${summary.homeDir}`
    );
    if (listFiles) {
      lines.push(...fileLines(summary.copied));
    }

    lines.push(`Per group: ${GROUP_ORDER.map((g) => `${g} ${summary.counts[g]}`).join(", ")}`);

    if (summary.tooLarge.length > 0) {
      lines.push(`Skipped, larger than ${summary.maxFileSizeMb} MB (${summary.tooLarge.length}):`);
      lines.push(
        ...summary.tooLarge.map((file) => `  ${file.path} (${Reporter.bytes(file.size)})`)
      );
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
    lines.push(...Reporter.outputLines(summary, "  "));
    if (summary.dryRun) {
      lines.push("Dry run: nothing was written.");
    }

    return lines.join("\n");
  }

  static restoreSummary(summary: RestoreSummary): string {
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
  static foundTargets(found: readonly FoundTarget[]): string {
    if (found.length === 0) {
      return "No dotfiles from the default list were found.";
    }

    const byCategory = new Map<string, string[]>();
    for (const target of found) {
      const paths = byCategory.get(target.category) ?? [];
      paths.push(target.path);
      byCategory.set(target.category, paths);
    }
    return [...byCategory]
      .map(([category, paths]) => `${category}: ${paths.join(", ")}`)
      .join("\n");
  }

  /** The rules that apply no matter which options are chosen; shown in the intro and --help. */
  static neverCopied(maxFileSizeMb: number): string {
    return [
      `Directories named ${HARD_EXCLUDED_DIR_NAMES.join(", ")}`,
      "~/Library/Caches and ~/Library/Application Support/*/Cache*",
      "SSH private keys: everything in ~/.ssh except config and *.pub",
      "GPG private keys: ~/.gnupg/private-keys-v1.d, *.gpg and *.kbx",
      `Files larger than ${maxFileSizeMb} MB`,
      ".env files and other secrets are included by default; --no-include-env (or include_env = false) leaves them out",
      `The .env scan looks ${ENV_SCAN_MAX_DEPTH} levels deep and never enters ${ENV_SCAN_SKIPPED_FOLDERS.map((name) => `~/${name}`).join(", ")}`,
    ].join("\n");
  }
}

function fileLines(files: readonly PlannedFile[]): string[] {
  return files.map((file) => `  ${file.path} (${Reporter.bytes(file.size)}) [${file.group}]`);
}
