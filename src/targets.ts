export type TargetGroup = "core" | "secrets" | "config-all" | "custom";

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

// ---------------------------------------------------------------------------------------------
// Default targets, by category
// ---------------------------------------------------------------------------------------------

export const SHELL_TARGETS: readonly string[] = [
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".inputrc",
];

export const GIT_TARGETS: readonly string[] = [
  ".gitconfig",
  ".gitignore_global",
  ".gitattributes_global",
];

export const EDITOR_TARGETS: readonly string[] = [
  ".vimrc",
  ".ideavimrc",
  ".config/nvim",
  ".editorconfig",
];

/** VS Code and Cursor keep the same three user files under `<base>/User/`. */
export const EDITOR_USER_FILES: readonly string[] = [
  "settings.json",
  "keybindings.json",
  "snippets",
];

/** Where VS Code keeps its `User/` directory: macOS, then Linux. */
export const VSCODE_USER_DIRS: readonly string[] = [
  "Library/Application Support/Code",
  ".config/Code",
];

/** Where Cursor keeps its `User/` directory: macOS, then Linux. */
export const CURSOR_USER_DIRS: readonly string[] = [
  "Library/Application Support/Cursor",
  ".config/Cursor",
];

export const TERMINAL_TARGETS: readonly string[] = [
  ".tmux.conf",
  ".config/tmux",
  ".config/starship.toml",
  ".config/alacritty",
  ".config/kitty",
  ".config/wezterm",
  ".config/ghostty",
  ".config/fish",
  ".config/zellij",
];

export const TOOL_TARGETS: readonly string[] = [
  ".config/mise",
  ".tool-versions",
  ".config/gh/config.yml",
  ".config/htop",
  ".config/bat",
  ".config/lazygit",
];

export const MACOS_TARGETS: readonly string[] = [
  ".hammerspoon",
  ".config/karabiner",
  ".skhdrc",
  ".yabairc",
  ".Brewfile",
  "Brewfile",
];

/** The non-secret parts of the secret-adjacent tools; the keys themselves are never copied. */
export const SSH_GPG_AWS_TARGETS: readonly string[] = [
  ".ssh/config",
  ".gnupg/gpg.conf",
  ".gnupg/gpg-agent.conf",
  ".aws/config",
];

/** Credential files: the `secrets` group, collected only with `includeEnv`. */
export const SECRET_TARGETS: readonly string[] = [
  ".npmrc",
  ".yarnrc",
  ".netrc",
  ".aws/credentials",
  ".docker/config.json",
];

/** `<base>/User/settings.json` and friends for every listed base directory. */
function editorUserFiles(bases: readonly string[]): string[] {
  return bases.flatMap((base) => EDITOR_USER_FILES.map((file) => `${base}/User/${file}`));
}

/** The default list, in the order targets are attempted and reported. */
export const TARGET_CATEGORIES: readonly TargetCategory[] = [
  { category: "Shell", group: "core", paths: SHELL_TARGETS },
  { category: "Git", group: "core", paths: GIT_TARGETS },
  { category: "Editors", group: "core", paths: EDITOR_TARGETS },
  { category: "VS Code", group: "core", paths: editorUserFiles(VSCODE_USER_DIRS) },
  { category: "Cursor", group: "core", paths: editorUserFiles(CURSOR_USER_DIRS) },
  { category: "Terminal", group: "core", paths: TERMINAL_TARGETS },
  { category: "Tools", group: "core", paths: TOOL_TARGETS },
  { category: "macOS", group: "core", paths: MACOS_TARGETS },
  { category: "SSH / GPG / AWS", group: "core", paths: SSH_GPG_AWS_TARGETS },
  { category: "Secrets", group: "secrets", paths: SECRET_TARGETS },
];

function toSpecs({ category, group, paths }: TargetCategory): TargetSpec[] {
  return paths.map((path) => ({ path, group, category }));
}

/**
 * What gets collected. `core` entries are always attempted; `secrets` entries only with
 * `includeEnv`. Entries that do not exist on the machine are skipped.
 */
export const DEFAULT_TARGETS: readonly TargetSpec[] = TARGET_CATEGORIES.flatMap(toSpecs);

// ---------------------------------------------------------------------------------------------
// Never-copied rules
// ---------------------------------------------------------------------------------------------

/**
 * Directory (or file) names that are never copied, wherever they appear in a path, even for
 * opted-in groups and config-file includes.
 */
export const HARD_EXCLUDED_DIR_NAMES: readonly string[] = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "Cache",
  "Caches",
  "CachedData",
  "Code Cache",
  "GPUCache",
  "Service Worker",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".cargo",
  ".rustup",
  ".gradle",
  ".m2",
  ".Trash",
  "Trash",
  ".DS_Store",
];

const HARD_EXCLUDED = new Set(HARD_EXCLUDED_DIR_NAMES);

/** macOS: `~/Library/Caches` and `~/Library/Application Support/<app>/Cache*` are never copied. */
export const MACOS_LIBRARY_DIR = "Library";
export const MACOS_LIBRARY_CACHES_DIR = "Caches";
export const MACOS_APPLICATION_SUPPORT_DIR = "Application Support";
export const MACOS_APP_CACHE_DIR_PREFIX = "Cache";

/** SSH: everything under `~/.ssh` is a private key except `config` and `*.pub`. */
export const SSH_DIR = ".ssh";
export const SSH_CONFIG_FILE = "config";
export const SSH_PUBLIC_KEY_SUFFIX = ".pub";

/** GnuPG: the private key store, and keyrings / key boxes (with or without a `~` backup suffix). */
export const GNUPG_DIR = ".gnupg";
export const GNUPG_PRIVATE_KEYS_DIR = "private-keys-v1.d";
export const GNUPG_KEYRING_PATTERN = /\.(gpg|kbx)~?$/;

/** `dotfiles-YYYYMMDD-HHMMSS`, the name of every collection folder this tool writes. */
export const COLLECTION_NAME_PATTERN = /^dotfiles-\d{8}-\d{6}$/;

/** A collection folder or one of its archives; previous runs are never collected again. */
export const COLLECTION_ARTIFACT_PATTERN = /^dotfiles-\d{8}-\d{6}(\.zip|\.tar\.gz)?$/;

// ---------------------------------------------------------------------------------------------
// .env scan settings
// ---------------------------------------------------------------------------------------------

/** How deep below the home directory the `.env` scan looks: `~/a/b/c/.env` is depth 4. */
export const ENV_SCAN_MAX_DEPTH = 4;

/**
 * Top-level home folders the `.env` scan never enters (the scan only: core targets such as the
 * VS Code settings under `~/Library` are still collected). On macOS, merely listing these
 * triggers the "Terminal would like to access your Documents folder" permission prompts.
 */
export const ENV_SCAN_SKIPPED_FOLDERS: readonly string[] = [
  "Library",
  "Desktop",
  "Documents",
  "Downloads",
  "Movies",
  "Music",
  "Pictures",
  "Public",
];

/** `.env` itself and `.env.<anything>`. */
export const ENV_FILE_NAME = ".env";
export const ENV_FILE_PREFIX = ".env.";

// ---------------------------------------------------------------------------------------------
// User exclude normalisation
// ---------------------------------------------------------------------------------------------

const LEADING_DOT_SLASH = /^\.\//;
const TRAILING_SLASHES = /\/+$/;

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export function isEnvFile(name: string): boolean {
  return name === ENV_FILE_NAME || name.startsWith(ENV_FILE_PREFIX);
}

/**
 * Private keys are never copied, whatever the options: everything under `.ssh` except
 * `config` and `*.pub`, and GnuPG's private key store, keyrings and key boxes.
 */
function isPrivateKeyPath(segments: readonly string[]): boolean {
  if (segments.length < 2) return false;

  if (segments[0] === SSH_DIR) {
    const rest = segments.slice(1).join("/");
    return rest !== SSH_CONFIG_FILE && !rest.endsWith(SSH_PUBLIC_KEY_SUFFIX);
  }

  if (segments[0] === GNUPG_DIR) {
    if (segments[1] === GNUPG_PRIVATE_KEYS_DIR) return true;
    return GNUPG_KEYRING_PATTERN.test(segments[segments.length - 1]);
  }

  return false;
}

function isMacOsCachePath(segments: readonly string[]): boolean {
  if (segments[0] !== MACOS_LIBRARY_DIR) return false;
  if (segments[1] === MACOS_LIBRARY_CACHES_DIR) return true;
  return (
    segments[1] === MACOS_APPLICATION_SUPPORT_DIR &&
    segments.length >= 4 &&
    segments[3].startsWith(MACOS_APP_CACHE_DIR_PREFIX)
  );
}

/** The excludes that apply to everything, including opted-in groups and config includes. */
export function isHardExcluded(relPath: string): boolean {
  const segments = relPath.split("/");

  if (segments.some((s) => HARD_EXCLUDED.has(s) || COLLECTION_ARTIFACT_PATTERN.test(s))) {
    return true;
  }
  if (isMacOsCachePath(segments)) return true;

  return isPrivateKeyPath(segments);
}

/**
 * User excludes from `~/.dotfilesrc.toml`: a bare name matches any path segment, an entry
 * containing `/` matches that home-relative path and everything under it.
 */
export interface ExcludeRules {
  readonly names: ReadonlySet<string>;
  readonly paths: readonly string[];
}

export function compileExcludes(entries: readonly string[]): ExcludeRules {
  const names = new Set<string>();
  const paths: string[] = [];

  for (const raw of entries) {
    const entry = raw.replace(LEADING_DOT_SLASH, "").replace(TRAILING_SLASHES, "");
    if (entry.includes("/")) {
      paths.push(entry);
    } else {
      names.add(entry);
    }
  }

  return { names, paths };
}

export function isExcluded(relPath: string, rules?: ExcludeRules): boolean {
  if (isHardExcluded(relPath)) return true;
  if (rules === undefined) return false;

  if (relPath.split("/").some((segment) => rules.names.has(segment))) return true;
  return rules.paths.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}
