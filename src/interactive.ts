import { basename } from "node:path";
import { type CollectOptions, type CollectSummary, writePlan } from "./collect";
import type { OutputFormat } from "./formats";
import { resolveOptions } from "./options";
import { filterPlan, type Plan, resolveTargets } from "./plan";
import { formatBytes, formatFoundTargets, formatNeverCopied, formatSummary } from "./report";
import { isEnvFile } from "./targets";

/** Returned by a {@link Prompter} when the user aborts (Ctrl+C / Esc). */
export const CANCEL: unique symbol = Symbol("create-dotfiles.cancel");
export type Cancelled = typeof CANCEL;

export interface ConfirmPrompt {
  message: string;
  initialValue: boolean;
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface MultiselectPrompt<T extends string> {
  message: string;
  options: SelectOption<T>[];
  initialValues: T[];
  required: boolean;
}

export interface SpinnerHandle {
  start(message: string): void;
  message(message: string): void;
  stop(message: string): void;
}

/**
 * The prompts the interactive flow needs. `clack-prompter.ts` implements it with
 * @clack/prompts; tests drive the flow with a scripted fake instead of a terminal.
 */
export interface Prompter {
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  note(message: string, title: string): void;
  confirm(prompt: ConfirmPrompt): Promise<boolean | Cancelled>;
  multiselect<T extends string>(prompt: MultiselectPrompt<T>): Promise<T[] | Cancelled>;
  spinner(): SpinnerHandle;
}

/** Command-line flags act as the pre-filled defaults of the prompts. */
export type InteractiveOptions = Omit<CollectOptions, "onProgress">;

export type InteractiveResult = { cancelled: true } | { cancelled: false; summary: CollectSummary };

const FORMAT_OPTIONS: SelectOption<OutputFormat>[] = [
  { value: "folder", label: "folder", hint: "dotfiles-YYYYMMDD-HHMMSS/" },
  { value: "zip", label: "zip", hint: "dotfiles-YYYYMMDD-HHMMSS.zip" },
  { value: "tar", label: "tar.gz", hint: "dotfiles-YYYYMMDD-HHMMSS.tar.gz" },
];

function toMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function outputPreview(plan: Plan): string {
  const lines = [`${plan.files.length} files, ${formatBytes(plan.totalBytes)}`];
  if (plan.tooLarge.length > 0) {
    lines.push(`${plan.tooLarge.length} file(s) over ${plan.maxFileSizeMb} MB will be skipped`);
  }
  if (plan.outputs.folder !== undefined) lines.push(`folder: ${plan.outputs.folder}/`);
  if (plan.outputs.zip !== undefined) lines.push(`zip:    ${plan.outputs.zip}`);
  if (plan.outputs.tar !== undefined) lines.push(`tar.gz: ${plan.outputs.tar}`);
  return lines.join("\n");
}

/**
 * The interactive collection flow. The home directory is scanned once with every group
 * enabled, so the questions can quote real counts; the answers then narrow that plan.
 * Cancelling at any prompt (or answering No to the final confirm) writes nothing.
 */
export async function runInteractive(
  prompter: Prompter,
  options: InteractiveOptions = {}
): Promise<InteractiveResult> {
  const cancelled = (): InteractiveResult => {
    prompter.cancel("Cancelled.");
    return { cancelled: true };
  };
  const defaults = resolveOptions(options);

  prompter.intro("create-dotfiles");

  const scanning = prompter.spinner();
  scanning.start(`Scanning ${defaults.homeDir}`);
  const full = resolveTargets({
    ...options,
    config: defaults.config,
    includeEnv: true,
    includeConfig: true,
  });
  scanning.stop(`Scanned ${defaults.homeDir}`);

  const listed = full.found.filter((t) => t.group === "core" || t.group === "custom");
  prompter.note(formatFoundTargets(listed), "Found on this machine");
  prompter.note(formatNeverCopied(defaults.maxFileSizeMb), "Never copied");

  const envCount = full.files.filter(
    (f) => f.group === "secrets" && isEnvFile(basename(f.path))
  ).length;
  const includeEnv = await prompter.confirm({
    message: `Include secret files? (.env files found by scan: ${envCount}, plus .npmrc/.netrc/.aws/credentials/.docker/config.json)`,
    initialValue: defaults.includeEnv,
  });
  if (includeEnv === CANCEL) return cancelled();

  const configFiles = full.files.filter((f) => f.group === "config-all");
  const configBytes = configFiles.reduce((sum, f) => sum + f.size, 0);
  const includeConfig = await prompter.confirm({
    message: `Include everything under ~/.config? (${configFiles.length} files, ~${toMb(configBytes)} MB after excludes)`,
    initialValue: defaults.includeConfig,
  });
  if (includeConfig === CANCEL) return cancelled();

  let formats: OutputFormat[] = [];
  while (formats.length === 0) {
    const answer = await prompter.multiselect<OutputFormat>({
      message: "Output formats",
      options: FORMAT_OPTIONS,
      initialValues: defaults.formats,
      required: true,
    });
    if (answer === CANCEL) return cancelled();
    if (answer.length === 0) prompter.note("Select at least one output format.", "Output formats");
    formats = answer;
  }

  const plan = filterPlan(full, {
    includeEnv,
    includeConfig,
    formats,
    now: options.now ?? new Date(),
  });
  prompter.note(outputPreview(plan), "Output");
  const proceed = await prompter.confirm({ message: "Proceed?", initialValue: true });
  if (proceed === CANCEL || !proceed) return cancelled();

  if (options.dryRun) {
    const summary = await writePlan(plan, { dryRun: true });
    prompter.note(formatSummary(summary), "Dry run");
    prompter.outro("Dry run: nothing was written.");
    return { cancelled: false, summary };
  }

  const progress = prompter.spinner();
  progress.start("Collecting dotfiles");
  let summary: CollectSummary;
  try {
    summary = await writePlan(plan, {
      onProgress: (p) => progress.message(`Copying ${p.done}/${p.total}: ${p.file.path}`),
    });
  } catch (err) {
    progress.stop("Collection failed");
    throw err;
  }
  progress.stop(`Collected ${summary.copied.length} files (${formatBytes(summary.copiedBytes)})`);

  prompter.note(formatSummary(summary), "Summary");
  prompter.outro(`Done: ${summary.written.join(", ")}`);
  return { cancelled: false, summary };
}
