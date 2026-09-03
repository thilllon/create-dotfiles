import { resolve } from "node:path";
import cac from "cac";
import packageJson from "../package.json";
import { createClackPrompter } from "./clack-prompter";
import {
  type CollectOptions,
  collect,
  DEFAULT_MAX_FILE_SIZE_MB,
  DotfileError,
  formatNeverCopied,
  formatRestoreSummary,
  formatSummary,
  parseFormats,
  restore,
  runInteractive,
} from "./index";

const cli = cac("create-dotfiles");

interface CollectFlags {
  auto?: boolean;
  includeEnv?: boolean;
  includeConfig?: boolean;
  /** cac yields `0` for `--format ""` (and `true` for a bare `--format`), not a string. */
  format?: string | string[] | number | boolean;
  out?: string;
  maxFileSize?: number | string;
  dryRun?: boolean;
}

/**
 * Nothing under the home directory is read or written until a command action runs, so
 * `--help` and `--version` stay side-effect free. Expected failures are reported without a
 * stack trace.
 */
function run<A extends unknown[]>(action: (...args: A) => void | Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (err) {
      if (err instanceof DotfileError) {
        console.error(`Error: ${err.message}`);
      } else {
        console.error(`Unexpected error: ${(err as Error).message}`);
      }
      process.exitCode = 1;
    }
  };
}

/** A `--format` value that is not text means no format was given; parseFormats says so. */
function formatFlag(value: NonNullable<CollectFlags["format"]>): string | string[] {
  return typeof value === "string" || Array.isArray(value) ? value : "";
}

/** Flags that were not given stay undefined so the config file's `[settings]` can fill them. */
function toOptions(flags: CollectFlags): CollectOptions {
  return {
    includeEnv: flags.includeEnv,
    includeConfig: flags.includeConfig,
    formats: flags.format === undefined ? undefined : parseFormats(formatFlag(flags.format)),
    outDir: flags.out === undefined ? undefined : resolve(flags.out),
    maxFileSizeMb: flags.maxFileSize === undefined ? undefined : Number(flags.maxFileSize),
    dryRun: flags.dryRun,
  };
}

cli
  .command("", "Collect dotfiles into a timestamped folder, zip and/or tar.gz (default)")
  .option("--auto", "Non-interactive run with defaults (implied when not in a terminal)")
  .option(
    "--include-env",
    "Include secrets: .env files, .npmrc, .yarnrc, .netrc, .aws/credentials, .docker/config.json (default: on; --no-include-env to leave them out)"
  )
  .option("--include-config", "Include everything under ~/.config")
  .option("--format <list>", "Comma-separated output formats: folder, zip, tar (default: folder)")
  .option("--out <dir>", "Parent directory for the output (default: home directory)")
  .option(
    "--max-file-size <mb>",
    `Skip files larger than this many MB (default: ${DEFAULT_MAX_FILE_SIZE_MB})`
  )
  .option(
    "--dry-run",
    "Print what would be collected, with sizes and output paths, and write nothing"
  )
  .action(
    run(async (flags: CollectFlags) => {
      const options = toOptions(flags);
      const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

      if (flags.auto || !interactive) {
        if (!flags.auto) {
          console.log("Not running in an interactive terminal; using --auto defaults.");
        }
        const summary = await collect(options);
        console.log(formatSummary(summary, { listFiles: true }));
        return;
      }

      // A cancelled run has already printed "Cancelled." and exits 0 without writing.
      await runInteractive(createClackPrompter(), options);
    })
  );

cli
  .command("restore [source]", "Copy a collection folder back into the home directory")
  .option("--force", "Overwrite files that already exist in the home directory")
  .action(
    run((source: string | undefined, flags: { force?: boolean }) => {
      const summary = restore({ source, force: flags.force ?? false });
      console.log(formatRestoreSummary(summary));
    })
  );

cli.help((sections) => {
  const indent = (text: string) => text.replace(/^/gm, "  ");
  sections.push({
    title: "Never copied (regardless of options)",
    body: indent(formatNeverCopied(DEFAULT_MAX_FILE_SIZE_MB)),
  });
  sections.push({
    title: "Config file (optional, never created)",
    body: indent(
      [
        "~/.dotfilesrc.toml",
        "[files] include = [...] extra home-relative paths; exclude = [...] paths or directory names",
        "[settings] max_file_size_mb, include_env, include_config, formats = [...], out",
      ].join("\n")
    ),
  });
  sections.push({
    title: "Restore",
    body: indent(
      "restore defaults to the newest ~/dotfiles-YYYYMMDD-HHMMSS folder; archives must be extracted first."
    ),
  });
});
cli.version(packageJson.version);

const parsed = cli.parse(process.argv, { run: false });

// cac routes any unrecognized command into the default command; reject it instead of
// silently collecting.
const [command] = parsed.args;
if (cli.matchedCommand?.name === "" && command !== undefined) {
  console.error(`Unknown command: ${command}`);
  cli.outputHelp();
  process.exitCode = 1;
} else {
  try {
    cli.runMatchedCommand();
  } catch (err) {
    // cac rejects unknown flags and missing option values before the action runs. Those are
    // user errors like any DotfileError: a message and exit 1, not a stack trace.
    if ((err as Error).name !== "CACError") throw err;
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
