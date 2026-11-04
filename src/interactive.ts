import { posix } from "node:path";
import {
  type CollectOptions,
  type CollectSummary,
  Collector,
  ZipPassword,
  type ZipPasswordSource,
} from "./collect";
import { type OutputFormat, Options } from "./config";
import { BYTES_PER_MB, CANCEL, FORMAT_OPTIONS, MIN_ZIP_PASSWORD_LENGTH } from "./constants";
import { DotfileError } from "./errors";
import { type Plan, Planner } from "./plan";
import { Reporter } from "./report";
import { Targets } from "./targets";

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

export interface PasswordPrompt {
  message: string;
  /** Why the entry is not acceptable, or `undefined` when it is. An empty entry arrives as "". */
  validate?: (value: string) => string | undefined;
}

export interface SpinnerHandle {
  start(message: string): void;
  message(message: string): void;
  stop(message: string): void;
}

/**
 * The prompts the interactive flow needs. `ClackPrompter` implements it with @clack/prompts;
 * tests drive the flow with a scripted fake instead of a terminal.
 */
export interface Prompter {
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  note(message: string, title: string): void;
  confirm(prompt: ConfirmPrompt): Promise<boolean | Cancelled>;
  multiselect<T extends string>(prompt: MultiselectPrompt<T>): Promise<T[] | Cancelled>;
  /**
   * A masked entry; resolves to "" when the user just presses Enter. Optional so that prompters
   * written before zip encryption still type-check; without it an encrypted zip needs
   * `zipPassword` in the options.
   */
  password?(prompt: PasswordPrompt): Promise<string | Cancelled>;
  spinner(): SpinnerHandle;
}

/** Command-line flags act as the pre-filled defaults of the prompts. */
export type InteractiveOptions = Omit<CollectOptions, "onProgress">;

export type InteractiveResult = { cancelled: true } | { cancelled: false; summary: CollectSummary };

function toMb(bytes: number): string {
  return (bytes / BYTES_PER_MB).toFixed(1);
}

function outputPreview(plan: Plan): string {
  const lines = [`${plan.files.length} files, ${Reporter.bytes(plan.totalBytes)}`];
  if (plan.tooLarge.length > 0) {
    lines.push(`${plan.tooLarge.length} file(s) over ${plan.maxFileSizeMb} MB will be skipped`);
  }
  lines.push(...Reporter.outputLines(plan));
  return lines.join("\n");
}

/**
 * The interactive collection flow. The home directory is scanned once with every group
 * enabled, so the questions can quote real counts; the answers then narrow that plan.
 * Cancelling at any prompt (or answering No to the final confirm) writes nothing.
 */
export class InteractiveSession {
  constructor(
    private readonly prompter: Prompter,
    private readonly options: InteractiveOptions = {}
  ) {}

  async run(): Promise<InteractiveResult> {
    const { prompter, options } = this;
    // Encryption is settled by its own question once the formats are known; until then it plays
    // no part (and `encryptZip` with the default formats would not even resolve).
    const defaults = Options.resolve({ ...options, encryptZip: undefined });
    const encryptByDefault = options.encryptZip ?? defaults.config.settings.encryptZip ?? false;

    prompter.intro("create-dotfiles");

    const scanning = prompter.spinner();
    scanning.start(`Scanning ${defaults.homeDir}`);
    const full = Planner.plan({
      ...options,
      config: defaults.config,
      includeEnv: true,
      includeConfig: true,
      encryptZip: false,
    });
    scanning.stop(`Scanned ${defaults.homeDir}`);

    const listed = full.found.filter((t) => t.group === "core" || t.group === "custom");
    prompter.note(Reporter.foundTargets(listed), "Found on this machine");
    prompter.note(Reporter.neverCopied(defaults.maxFileSizeMb), "Never copied");

    const envCount = full.files.filter(
      (f) => f.group === "secrets" && Targets.isEnvFile(posix.basename(f.path))
    ).length;
    const includeEnv = await prompter.confirm({
      message: `Include secret files? (.env files found by scan: ${envCount}, plus .npmrc/.netrc/.aws/credentials/.docker/config.json)`,
      initialValue: defaults.includeEnv,
    });
    if (includeEnv === CANCEL) {
      return this.cancelled();
    }

    const configFiles = full.files.filter((f) => f.group === "config-all");
    const configBytes = configFiles.reduce((sum, f) => sum + f.size, 0);
    const includeConfig = await prompter.confirm({
      message: `Include everything under ~/.config? (${configFiles.length} files, ~${toMb(configBytes)} MB after excludes)`,
      initialValue: defaults.includeConfig,
    });
    if (includeConfig === CANCEL) {
      return this.cancelled();
    }

    let formats: OutputFormat[] = [];
    while (formats.length === 0) {
      const answer = await prompter.multiselect<OutputFormat>({
        message: "Output formats",
        options: [...FORMAT_OPTIONS],
        initialValues: defaults.formats,
        required: true,
      });
      if (answer === CANCEL) {
        return this.cancelled();
      }
      if (answer.length === 0) {
        prompter.note("Select at least one output format.", "Output formats");
      }
      formats = answer;
    }

    let encryptZip = false;
    let zipPassword: string | undefined;
    if (formats.includes("zip")) {
      const answer = await prompter.confirm({
        message: "Protect the zip with a password? (AES-256)",
        initialValue: encryptByDefault,
      });
      if (answer === CANCEL) {
        return this.cancelled();
      }
      encryptZip = answer;
      // A dry run encrypts nothing, so it does not ask for a password.
      if (encryptZip && !options.dryRun) {
        const password = await this.askZipPassword(options.zipPassword);
        if (password === CANCEL) {
          return this.cancelled();
        }
        zipPassword = password;
      }
    }

    const plan = Planner.filter(full, {
      includeEnv,
      includeConfig,
      formats,
      encryptZip,
      now: options.now ?? new Date(),
    });
    prompter.note(outputPreview(plan), "Output");
    const proceed = await prompter.confirm({ message: "Proceed?", initialValue: true });
    if (proceed === CANCEL || !proceed) {
      return this.cancelled();
    }

    if (options.dryRun) {
      const summary = await new Collector(plan, { dryRun: true }).write();
      prompter.note(Reporter.summary(summary), "Dry run");
      prompter.outro("Dry run: nothing was written.");
      return { cancelled: false, summary };
    }

    const progress = prompter.spinner();
    progress.start("Collecting dotfiles");
    let summary: CollectSummary;
    try {
      summary = await new Collector(plan, {
        onProgress: (p) => progress.message(`Copying ${p.done}/${p.total}: ${p.file.path}`),
        zipPassword,
      }).write();
    } catch (err) {
      progress.stop("Collection failed");
      throw err;
    }
    progress.stop(
      `Collected ${summary.copied.length} files (${Reporter.bytes(summary.copiedBytes)})`
    );

    prompter.note(Reporter.summary(summary), "Summary");
    prompter.outro(`Done: ${summary.written.join(", ")}`);
    return { cancelled: false, summary };
  }

  private cancelled(): InteractiveResult {
    this.prompter.cancel("Cancelled.");
    return { cancelled: true };
  }

  /**
   * The password for an encrypted zip: one the caller supplied, else a masked entry typed twice
   * (a mismatch starts over, so a typo in the first entry can be fixed). An empty entry
   * generates one instead, shown once, and it is used only after the user says they have stored
   * it. Answering No goes back to the entry: an Enter meant for the previous question (clack's
   * confirm submits on "y" alone) lands here as an empty entry, and that user should still get
   * to type their own.
   */
  private async askZipPassword(source: ZipPasswordSource | undefined): Promise<string | Cancelled> {
    const { prompter } = this;
    const given = typeof source === "function" ? source() : source;
    if (given !== undefined) {
      ZipPassword.assert(given);
      prompter.note(
        "Using the zip password that was supplied, so it is not asked for.",
        "Zip password"
      );
      return given;
    }
    if (prompter.password === undefined) {
      throw new DotfileError(
        "This prompter cannot ask for a password: pass zipPassword to encrypt the zip"
      );
    }
    const ask = prompter.password.bind(prompter);

    for (;;) {
      const password = await ask({
        message: `Zip password (at least ${MIN_ZIP_PASSWORD_LENGTH} characters; leave empty to generate one)`,
        validate: (value) => (value === "" ? undefined : ZipPassword.problem(value)),
      });
      if (password === CANCEL) {
        return CANCEL;
      }

      if (password !== "") {
        const repeated = await ask({ message: "Repeat the zip password" });
        if (repeated === CANCEL) {
          return CANCEL;
        }
        if (repeated === password) {
          return password;
        }
        prompter.note("The passwords do not match. Enter the password again.", "Zip password");
        continue;
      }

      const generated = ZipPassword.generate();
      prompter.note(
        `${generated}\n\nThe entry was left empty, so this password was generated. Store it in a password manager now: it is not saved anywhere, and the zip cannot be opened without it.`,
        "Generated zip password"
      );
      const stored = await prompter.confirm({
        message: "Have you stored it? (No to type your own password instead)",
        initialValue: false,
      });
      if (stored === CANCEL) {
        return CANCEL;
      }
      if (stored) {
        return generated;
      }
    }
  }
}
