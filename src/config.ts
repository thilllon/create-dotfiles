import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, relative, resolve, sep, win32 } from "node:path";
import { parse } from "smol-toml";
import {
  CONFIG_BOOLEAN_SETTINGS,
  CONFIG_FILE,
  DEFAULT_FORMATS,
  DEFAULT_MAX_FILE_SIZE_MB,
  FORMAT_ALIASES,
  TRAILING_SLASHES_AFTER_NAME,
} from "./constants";
import { DotfileError } from "./errors";
import { PathUtils } from "./files";
import { Targets, type TargetPlatform } from "./targets";

export type OutputFormat = "folder" | "zip" | "tar";

export interface DotfilesSettings {
  maxFileSizeMb?: number;
  includeEnv?: boolean;
  includeConfig?: boolean;
  formats?: OutputFormat[];
  /** Encrypt the zip (AES-256). The password itself is never read from the config file. */
  encryptZip?: boolean;
  /** Parent directory for the output; relative paths and `~/` resolve against the home directory. */
  out?: string;
}

export interface DotfilesConfig {
  /** Extra home-relative paths to collect (the `custom` group). */
  include: string[];
  /** Extra excludes: bare names match any path segment, paths match a prefix. */
  exclude: string[];
  settings: DotfilesSettings;
}

type Table = Record<string, unknown>;

/** `~/.dotfilesrc.toml`: loading and validation. The file is never created. */
export class Config {
  static empty(): DotfilesConfig {
    return { include: [], exclude: [], settings: {} };
  }

  /** Reads `~/.dotfilesrc.toml` if present. */
  static load(homeDir: string): DotfilesConfig {
    const configPath = join(homeDir, CONFIG_FILE);
    if (!existsSync(configPath)) {
      return Config.empty();
    }
    return Config.parse(readFileSync(configPath, "utf8"), homeDir, configPath);
  }

  /** `parse()` returns `unknown`; malformed shapes are rejected here rather than cast blindly. */
  static parse(content: string, homeDir: string, configPath: string = CONFIG_FILE): DotfilesConfig {
    let parsed: unknown;
    try {
      parsed = parse(content);
    } catch (err) {
      throw new DotfileError(`Invalid TOML in ${configPath}: ${(err as Error).message}`);
    }

    const root = parsed as Table;
    const config = Config.empty();

    const files = table(root.files, "files", configPath);
    if (files !== undefined) {
      // `list` is the name older configs used for `include`; both are honoured.
      const include = [
        ...pathList(files.list, "files.list", homeDir, configPath),
        ...pathList(files.include, "files.include", homeDir, configPath),
      ];
      config.include = [...new Set(include)];
      config.exclude = pathList(files.exclude, "files.exclude", homeDir, configPath);
    }

    const settings = table(root.settings, "settings", configPath);
    if (settings !== undefined) {
      config.settings = parseSettings(settings, configPath);
    }

    return config;
  }

  /**
   * Rejects absolute paths and any entry that resolves outside the base directory. Absolute
   * means absolute on either platform (`/etc/x`, `C:\\x`, `\\\\server\\share`), whatever the
   * host, so a config file behaves the same wherever it is read. `shown` is the user's spelling
   * for error messages when `entry` has already been normalised.
   */
  static assertContainedPath(
    base: string,
    entry: string,
    label: string,
    shown: string = entry
  ): void {
    if (posix.isAbsolute(entry) || win32.isAbsolute(entry)) {
      throw new DotfileError(`${label} must be a relative path, got "${shown}"`);
    }

    const rel = relative(base, resolve(base, entry));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new DotfileError(`${label} must stay inside ${base}, got "${shown}"`);
    }
  }
}

function table(value: unknown, key: string, configPath: string): Table | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DotfileError(`[${key}] must be a table in ${configPath}`);
  }
  return value as Table;
}

function pathList(value: unknown, key: string, homeDir: string, configPath: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new DotfileError(`${key} must be an array in ${configPath}, got ${typeof value}`);
  }

  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new DotfileError(
        `${key} entries must be non-empty strings in ${configPath}, got ${JSON.stringify(entry)}`
      );
    }
    // Windows users write `AppData\\Roaming\\x`; every path is `/`-separated from here on.
    const slashed = PathUtils.normalizeSlashes(entry);
    Config.assertContainedPath(homeDir, slashed, `${key} entry`, entry);
    entries.push(normalizeEntry(slashed));
  }
  return entries;
}

/**
 * `./x`, `x/`, `a//b`, `a/../b` and `a\\b` all name the same home-relative path. One spelling
 * keeps the summary, the staged copy and the archive entry names in agreement; yazl refuses an
 * entry name with a `..` segment or a backslash outright, so an unnormalized include used to
 * fail the zip.
 */
function normalizeEntry(entry: string): string {
  return posix.normalize(entry).replace(TRAILING_SLASHES_AFTER_NAME, "$1");
}

function parseSettings(settings: Table, configPath: string): DotfilesSettings {
  const result: DotfilesSettings = {};
  const where = `in ${configPath}`;

  const size = settings.max_file_size_mb;
  if (size !== undefined) {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      throw new DotfileError(
        `settings.max_file_size_mb must be a positive number ${where}, got ${JSON.stringify(size)}`
      );
    }
    result.maxFileSizeMb = size;
  }

  for (const [key, field] of CONFIG_BOOLEAN_SETTINGS) {
    const flag = settings[key];
    if (flag === undefined) {
      continue;
    }
    if (typeof flag !== "boolean") {
      throw new DotfileError(
        `settings.${key} must be true or false ${where}, got ${JSON.stringify(flag)}`
      );
    }
    result[field] = flag;
  }

  const formats = settings.formats;
  if (formats !== undefined) {
    if (!Array.isArray(formats) || !formats.every((f) => typeof f === "string")) {
      throw new DotfileError(
        `settings.formats must be an array of strings ${where}, got ${JSON.stringify(formats)}`
      );
    }
    try {
      result.formats = Options.parseFormats(formats);
    } catch (err) {
      throw new DotfileError(`settings.formats ${where}: ${(err as Error).message}`);
    }
  }

  const out = settings.out;
  if (out !== undefined) {
    if (typeof out !== "string" || out.trim() === "") {
      throw new DotfileError(
        `settings.out must be a non-empty string ${where}, got ${JSON.stringify(out)}`
      );
    }
    result.out = out;
  }

  return result;
}

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
  /**
   * Encrypt the zip with WinZip AES-256; writing then needs `zipPassword`. Defaults to
   * `settings.encrypt_zip`, then false. `true` without `zip` among the formats is an error; the
   * config setting is simply ignored when no zip is written.
   */
  encryptZip?: boolean;
  /** Files larger than this are skipped and reported. Default 10. */
  maxFileSizeMb?: number;
  /** Timestamp for the `dotfiles-YYYYMMDD-HHMMSS` name. Defaults to now. */
  now?: Date;
  /** Pre-loaded config; when omitted `~/.dotfilesrc.toml` is read (never created). */
  config?: DotfilesConfig;
  /**
   * Which platform's default targets to attempt: a `process.platform` value (`darwin`, `linux`,
   * `win32`; anything else counts as `linux`). Defaults to the platform this process runs on.
   */
  platform?: string;
}

export interface ResolvedOptions {
  homeDir: string;
  outDir: string;
  includeEnv: boolean;
  includeConfig: boolean;
  formats: OutputFormat[];
  /** True only when a zip is written and it is to be encrypted. */
  encryptZip: boolean;
  maxFileSizeMb: number;
  now: Date;
  config: DotfilesConfig;
  platform: TargetPlatform;
}

/** Plan options: flags > config file `[settings]` > defaults. */
export class Options {
  /** Explicit options win over `[settings]` in the config file, which win over the defaults. */
  static resolve(options: PlanOptions = {}): ResolvedOptions {
    const homeDir = resolve(options.homeDir ?? homedir());
    const config = options.config ?? Config.load(homeDir);
    const { settings } = config;

    const maxFileSizeMb =
      options.maxFileSizeMb ?? settings.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB;
    if (
      typeof maxFileSizeMb !== "number" ||
      !Number.isFinite(maxFileSizeMb) ||
      maxFileSizeMb <= 0
    ) {
      throw new DotfileError(
        `Invalid max file size "${maxFileSizeMb}" (expected a positive number of MB)`
      );
    }

    const rawOut = options.outDir ?? settings.out;
    const outDir =
      rawOut === undefined ? homeDir : resolve(homeDir, PathUtils.expandHome(rawOut, homeDir));

    const formats = Options.parseFormats(options.formats ?? settings.formats ?? DEFAULT_FORMATS);
    const writesZip = formats.includes("zip");
    if (options.encryptZip === true && !writesZip) {
      throw new DotfileError(
        `Encrypting the zip needs "zip" among the output formats (got ${formats.join(", ")})`
      );
    }

    return {
      homeDir,
      outDir,
      includeEnv: options.includeEnv ?? settings.includeEnv ?? true,
      includeConfig: options.includeConfig ?? settings.includeConfig ?? false,
      formats,
      encryptZip: writesZip && (options.encryptZip ?? settings.encryptZip ?? false),
      maxFileSizeMb,
      now: options.now ?? new Date(),
      config,
      platform: Targets.resolvePlatform(options.platform),
    };
  }

  /**
   * Parses `--format folder,zip` style input (or an already split list) into a de-duplicated
   * list of formats. `tar.gz` and `tgz` are accepted as spellings of `tar`.
   */
  static parseFormats(input: string | readonly string[]): OutputFormat[] {
    // Anything that is not a list is treated as one value; a caller ignoring the types (or cac
    // handing over a number) gets "Unknown output format", not a TypeError.
    const items = Array.isArray(input) ? input : [input];
    const formats: OutputFormat[] = [];

    for (const item of items.flatMap((value) => String(value).split(","))) {
      const key = item.trim().toLowerCase();
      if (key === "") {
        continue;
      }
      const format = FORMAT_ALIASES[key];
      if (format === undefined) {
        throw new DotfileError(
          `Unknown output format "${item.trim()}" (expected folder, zip or tar)`
        );
      }
      if (!formats.includes(format)) {
        formats.push(format);
      }
    }

    if (formats.length === 0) {
      throw new DotfileError("At least one output format is required (folder, zip or tar)");
    }
    return formats;
  }
}
