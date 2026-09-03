import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type DotfilesConfig, loadConfig } from "./config";
import { DotfileError } from "./errors";
import { type OutputFormat, parseFormats } from "./formats";

export const DEFAULT_MAX_FILE_SIZE_MB = 10;
export const DEFAULT_FORMATS: readonly OutputFormat[] = ["folder"];

export interface PlanOptions {
  /** Directory to collect from. Defaults to `os.homedir()`. */
  homeDir?: string;
  /**
   * Parent directory for the output. Relative paths and `~/` resolve against the home
   * directory. Defaults to `settings.out` from the config file, then the home directory.
   */
  outDir?: string;
  /** Include the `secrets` group (`.env` files, `.npmrc`, `.netrc`, ...). Default true. */
  includeEnv?: boolean;
  /** Include everything under `~/.config`. Default false. */
  includeConfig?: boolean;
  /** Output formats. Default `["folder"]`. */
  formats?: readonly OutputFormat[];
  /** Files larger than this are skipped and reported. Default 10. */
  maxFileSizeMb?: number;
  /** Timestamp for the `dotfiles-YYYYMMDD-HHMMSS` name. Defaults to now. */
  now?: Date;
  /** Pre-loaded config; when omitted `~/.dotfilesrc.toml` is read (never created). */
  config?: DotfilesConfig;
}

export interface ResolvedOptions {
  homeDir: string;
  outDir: string;
  includeEnv: boolean;
  includeConfig: boolean;
  formats: OutputFormat[];
  maxFileSizeMb: number;
  now: Date;
  config: DotfilesConfig;
}

export function expandHome(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return join(homeDir, path.slice(2));
  return path;
}

/** Explicit options win over `[settings]` in the config file, which win over the defaults. */
export function resolveOptions(options: PlanOptions = {}): ResolvedOptions {
  const homeDir = resolve(options.homeDir ?? homedir());
  const config = options.config ?? loadConfig(homeDir);
  const { settings } = config;

  const maxFileSizeMb = options.maxFileSizeMb ?? settings.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
  if (typeof maxFileSizeMb !== "number" || !Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
    throw new DotfileError(
      `Invalid max file size "${maxFileSizeMb}" (expected a positive number of MB)`
    );
  }

  const rawOut = options.outDir ?? settings.out;
  const outDir = rawOut === undefined ? homeDir : resolve(homeDir, expandHome(rawOut, homeDir));

  return {
    homeDir,
    outDir,
    includeEnv: options.includeEnv ?? settings.includeEnv ?? true,
    includeConfig: options.includeConfig ?? settings.includeConfig ?? false,
    formats: parseFormats(options.formats ?? settings.formats ?? DEFAULT_FORMATS),
    maxFileSizeMb,
    now: options.now ?? new Date(),
    config,
  };
}
