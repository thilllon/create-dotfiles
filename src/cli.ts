import cac from "cac";
import packageJson from "../package.json";
import { DotfileError, DotfileManager } from "./dotfile-manager";

const cli = cac("create-dotfiles");

/**
 * Built per command rather than at module scope: constructing a manager reads and may create
 * `~/.dotfilesrc.toml`, which must not happen for `--help` or `--version`.
 */
function run(action: (manager: DotfileManager) => void | Promise<void>) {
  return async () => {
    try {
      await action(new DotfileManager());
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

cli.command("", "Backup dotfiles (default)").action(run((manager) => manager.backup()));

cli
  .command("restore", "Restore dotfiles from backup to home directory")
  .option("--force", "Overwrite files that already exist in the home directory")
  .action((options: { force?: boolean }) =>
    run((manager) => manager.restore({ force: options.force ?? false }))()
  );

cli.help();
cli.version(packageJson.version);

const parsed = cli.parse(process.argv, { run: false });

// cac routes any unrecognized command into the default command; reject it instead of
// silently running a backup.
const [command] = parsed.args;
if (command !== undefined) {
  console.error(`Unknown command: ${command}`);
  cli.outputHelp();
  process.exitCode = 1;
} else {
  cli.runMatchedCommand();
}
