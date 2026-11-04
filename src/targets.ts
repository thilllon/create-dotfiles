import {
  BACKSLASHES,
  COLLECTION_ARTIFACT_PATTERN,
  ENV_FILE_NAME,
  ENV_FILE_PREFIX,
  GNUPG_DIR,
  GNUPG_KEYRING_PATTERN,
  GNUPG_PRIVATE_KEYS_DIR,
  HARD_EXCLUDED_DIR_NAMES,
  LEADING_DOT_SLASH,
  MACOS_APP_CACHE_DIR_PREFIX,
  MACOS_APPLICATION_SUPPORT_DIR,
  MACOS_LIBRARY_CACHES_DIR,
  MACOS_LIBRARY_DIR,
  PATH_SEPARATORS,
  PLATFORM_TARGETS,
  SSH_CONFIG_FILE,
  SSH_DIR,
  SSH_PUBLIC_KEY_SUFFIX,
  TRAILING_SLASHES,
} from "./constants";

export type TargetGroup = "core" | "secrets" | "config-all" | "custom";

/** The platforms with their own default targets; anything else is treated as `linux`. */
export type TargetPlatform = "darwin" | "linux" | "win32";

export interface TargetSpec {
  /** Path relative to the home directory, with `/` separators. */
  path: string;
  group: "core" | "secrets";
  /** Heading used when listing which targets were found on the machine. */
  category: string;
}

/** One heading of the default target list and the home-relative paths under it. */
export interface TargetCategory {
  category: string;
  group: "core" | "secrets";
  paths: readonly string[];
}

const HARD_EXCLUDED = new Set(HARD_EXCLUDED_DIR_NAMES);

function segmentsOf(relPath: string): string[] {
  return relPath.split(PATH_SEPARATORS);
}

/** The default targets per platform and the rules that apply to every collected path. */
export class Targets {
  /** Maps a `process.platform` value onto the platforms with their own targets. */
  static resolvePlatform(platform: string = process.platform): TargetPlatform {
    if (platform === "darwin" || platform === "win32") {
      return platform;
    }
    return "linux";
  }

  /**
   * What gets collected on a platform (`process.platform` or one of {@link TargetPlatform}).
   * `core` entries are always attempted; `secrets` entries only with `includeEnv`. Entries that
   * do not exist on the machine are skipped.
   */
  static forPlatform(platform: string = process.platform): readonly TargetSpec[] {
    return PLATFORM_TARGETS[Targets.resolvePlatform(platform)];
  }

  static isEnvFile(name: string): boolean {
    return name === ENV_FILE_NAME || name.startsWith(ENV_FILE_PREFIX);
  }

  /** The excludes that apply to everything, including opted-in groups and config includes. */
  static isHardExcluded(relPath: string): boolean {
    const segments = segmentsOf(relPath);

    if (segments.some((s) => HARD_EXCLUDED.has(s) || COLLECTION_ARTIFACT_PATTERN.test(s))) {
      return true;
    }
    if (isMacOsCachePath(segments)) {
      return true;
    }
    return isPrivateKeyPath(segments);
  }
}

/**
 * Private keys are never copied, whatever the options: everything under `.ssh` except
 * `config` and `*.pub`, and GnuPG's private key store, keyrings and key boxes.
 */
function isPrivateKeyPath(segments: readonly string[]): boolean {
  if (segments.length < 2) {
    return false;
  }

  if (segments[0] === SSH_DIR) {
    const rest = segments.slice(1).join("/");
    return rest !== SSH_CONFIG_FILE && !rest.endsWith(SSH_PUBLIC_KEY_SUFFIX);
  }

  if (segments[0] === GNUPG_DIR) {
    if (segments[1] === GNUPG_PRIVATE_KEYS_DIR) {
      return true;
    }
    return GNUPG_KEYRING_PATTERN.test(segments[segments.length - 1]);
  }

  return false;
}

function isMacOsCachePath(segments: readonly string[]): boolean {
  if (segments[0] !== MACOS_LIBRARY_DIR) {
    return false;
  }
  if (segments[1] === MACOS_LIBRARY_CACHES_DIR) {
    return true;
  }
  return (
    segments[1] === MACOS_APPLICATION_SUPPORT_DIR &&
    segments.length >= 4 &&
    segments[3].startsWith(MACOS_APP_CACHE_DIR_PREFIX)
  );
}

/**
 * The excludes of a run: the hard excludes plus the user's from `~/.dotfilesrc.toml`. A bare
 * name matches any path segment; an entry containing a separator matches that home-relative
 * path and everything under it.
 */
export class ExcludeRules {
  readonly names: ReadonlySet<string>;
  readonly paths: readonly string[];

  constructor(entries: readonly string[] = []) {
    const names = new Set<string>();
    const paths: string[] = [];

    for (const raw of entries) {
      const entry = raw
        .replace(BACKSLASHES, "/")
        .replace(LEADING_DOT_SLASH, "")
        .replace(TRAILING_SLASHES, "");
      if (entry.includes("/")) {
        paths.push(entry);
      } else {
        names.add(entry);
      }
    }

    this.names = names;
    this.paths = paths;
  }

  matches(relPath: string): boolean {
    if (Targets.isHardExcluded(relPath)) {
      return true;
    }

    const segments = segmentsOf(relPath);
    if (segments.some((segment) => this.names.has(segment))) {
      return true;
    }
    const posixPath = segments.join("/");
    return this.paths.some((prefix) => posixPath === prefix || posixPath.startsWith(`${prefix}/`));
  }
}
