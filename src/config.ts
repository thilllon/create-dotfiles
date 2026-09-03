import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve, sep, win32 } from "node:path";
import { parse } from "smol-toml";
import { DotfileError } from "./errors";
import { type OutputFormat, parseFormats } from "./formats";
import { normalizeSlashes } from "./paths";

export const CONFIG_FILE = ".dotfilesrc.toml";

export interface DotfilesSettings {
  maxFileSizeMb?: number;
  includeEnv?: boolean;
  includeConfig?: boolean;
  formats?: OutputFormat[];
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

export function emptyConfig(): DotfilesConfig {
  return { include: [], exclude: [], settings: {} };
}

/**
 * Rejects absolute paths and any entry that resolves outside the base directory. Absolute
 * means absolute on either platform (`/etc/x`, `C:\\x`, `\\\\server\\share`), whatever the host,
 * so a config file behaves the same wherever it is read. `shown` is the user's spelling for
 * error messages when `entry` has already been normalised.
 */
export function assertContainedPath(
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

/** Reads `~/.dotfilesrc.toml` if present. The file is never created. */
export function loadConfig(homeDir: string): DotfilesConfig {
  const configPath = join(homeDir, CONFIG_FILE);
  if (!existsSync(configPath)) return emptyConfig();
  return parseConfig(readFileSync(configPath, "utf8"), homeDir, configPath);
}

type Table = Record<string, unknown>;

function table(value: unknown, key: string, configPath: string): Table | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DotfileError(`[${key}] must be a table in ${configPath}`);
  }
  return value as Table;
}

function pathList(value: unknown, key: string, homeDir: string, configPath: string): string[] {
  if (value === undefined) return [];
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
    const slashed = normalizeSlashes(entry);
    assertContainedPath(homeDir, slashed, `${key} entry`, entry);
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
  return posix.normalize(entry).replace(/(.)\/+$/, "$1");
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

  const booleans = [
    ["include_env", "includeEnv"],
    ["include_config", "includeConfig"],
  ] as const;
  for (const [key, field] of booleans) {
    const flag = settings[key];
    if (flag === undefined) continue;
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
      result.formats = parseFormats(formats);
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

/** `parse()` returns `unknown`; malformed shapes are rejected here rather than cast blindly. */
export function parseConfig(
  content: string,
  homeDir: string,
  configPath: string = CONFIG_FILE
): DotfilesConfig {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    throw new DotfileError(`Invalid TOML in ${configPath}: ${(err as Error).message}`);
  }

  const root = parsed as Table;
  const config = emptyConfig();

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
