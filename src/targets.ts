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

// ---------------------------------------------------------------------------------------------
// Default targets shared by every platform
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

/**
 * Terminal emulators and multiplexers. The `.config/...` variants stay on every platform:
 * wezterm and alacritty read them on Windows too, and `.wezterm.lua` is honoured everywhere.
 */
export const TERMINAL_TARGETS: readonly string[] = [
  ".tmux.conf",
  ".config/tmux",
  ".config/starship.toml",
  ".config/alacritty",
  ".config/kitty",
  ".config/wezterm",
  ".wezterm.lua",
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

// ---------------------------------------------------------------------------------------------
// Per-platform default targets
// ---------------------------------------------------------------------------------------------

/** VS Code, Cursor and their forks keep the same three user files under `<base>/User/`. */
export const EDITOR_USER_FILES: readonly string[] = [
  "settings.json",
  "keybindings.json",
  "snippets",
];

/** `<base>/User/settings.json` and friends for every listed base directory. */
function editorUserFiles(...bases: readonly string[]): string[] {
  return bases.flatMap((base) => EDITOR_USER_FILES.map((file) => `${base}/User/${file}`));
}

export const DARWIN_VSCODE_USER_DIRS: readonly string[] = ["Library/Application Support/Code"];
export const DARWIN_CURSOR_USER_DIRS: readonly string[] = ["Library/Application Support/Cursor"];
export const DARWIN_TARGETS: readonly string[] = [
  ".hammerspoon",
  ".config/karabiner",
  ".skhdrc",
  ".yabairc",
  ".Brewfile",
  "Brewfile",
];

export const LINUX_VSCODE_USER_DIRS: readonly string[] = [
  ".config/Code",
  ".config/Code - OSS",
  ".config/VSCodium",
];
export const LINUX_CURSOR_USER_DIRS: readonly string[] = [".config/Cursor"];
export const LINUX_TARGETS: readonly string[] = [
  ".bash_logout",
  ".xinitrc",
  ".xprofile",
  ".Xresources",
  ".config/i3",
  ".config/sway",
  ".config/hypr",
  ".config/waybar",
  ".config/rofi",
  ".config/dunst",
  ".config/picom",
  ".config/polybar",
  ".config/gtk-3.0/settings.ini",
  ".config/fontconfig",
];

/** Windows paths are relative to `%USERPROFILE%`, written with `/` like every other target. */
export const WIN32_VSCODE_USER_DIRS: readonly string[] = ["AppData/Roaming/Code"];
export const WIN32_CURSOR_USER_DIRS: readonly string[] = ["AppData/Roaming/Cursor"];
export const WIN32_TARGETS: readonly string[] = [
  "AppData/Local/nvim",
  "AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
  "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
  "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
  "AppData/Roaming/alacritty",
  ".wslconfig",
];

/** The categories every platform attempts, in the order targets are attempted and reported. */
export const COMMON_TARGET_CATEGORIES: readonly TargetCategory[] = [
  { category: "Shell", group: "core", paths: SHELL_TARGETS },
  { category: "Git", group: "core", paths: GIT_TARGETS },
  { category: "Editors", group: "core", paths: EDITOR_TARGETS },
  { category: "Terminal", group: "core", paths: TERMINAL_TARGETS },
  { category: "Tools", group: "core", paths: TOOL_TARGETS },
  { category: "SSH / GPG / AWS", group: "core", paths: SSH_GPG_AWS_TARGETS },
];

export const SECRET_TARGET_CATEGORIES: readonly TargetCategory[] = [
  { category: "Secrets", group: "secrets", paths: SECRET_TARGETS },
];

/** The categories added for one platform only; they never show up as "Not found" elsewhere. */
export const PLATFORM_TARGET_CATEGORIES: Readonly<
  Record<TargetPlatform, readonly TargetCategory[]>
> = {
  darwin: [
    { category: "VS Code", group: "core", paths: editorUserFiles(...DARWIN_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(...DARWIN_CURSOR_USER_DIRS) },
    { category: "macOS", group: "core", paths: DARWIN_TARGETS },
  ],
  linux: [
    { category: "VS Code", group: "core", paths: editorUserFiles(...LINUX_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(...LINUX_CURSOR_USER_DIRS) },
    { category: "Linux", group: "core", paths: LINUX_TARGETS },
  ],
  win32: [
    { category: "VS Code", group: "core", paths: editorUserFiles(...WIN32_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(...WIN32_CURSOR_USER_DIRS) },
    { category: "Windows", group: "core", paths: WIN32_TARGETS },
  ],
};

function toSpecs({ category, group, paths }: TargetCategory): TargetSpec[] {
  return paths.map((path) => ({ path, group, category }));
}

/** Maps a `process.platform` value onto the platforms with their own targets. */
export function resolveTargetPlatform(platform: string = process.platform): TargetPlatform {
  if (platform === "darwin" || platform === "win32") return platform;
  return "linux";
}

/** The targets shared by every platform: the common categories plus the secrets group. */
export const COMMON_TARGETS: readonly TargetSpec[] = [
  ...COMMON_TARGET_CATEGORIES,
  ...SECRET_TARGET_CATEGORIES,
].flatMap(toSpecs);

function targetsForPlatform(platform: TargetPlatform): TargetSpec[] {
  return [
    ...COMMON_TARGET_CATEGORIES,
    ...PLATFORM_TARGET_CATEGORIES[platform],
    ...SECRET_TARGET_CATEGORIES,
  ].flatMap(toSpecs);
}

/** The full default list per platform: common first, then platform-specific, then secrets. */
export const PLATFORM_TARGETS: Readonly<Record<TargetPlatform, readonly TargetSpec[]>> = {
  darwin: targetsForPlatform("darwin"),
  linux: targetsForPlatform("linux"),
  win32: targetsForPlatform("win32"),
};

/**
 * What gets collected on a platform (`process.platform` or one of {@link TargetPlatform}).
 * `core` entries are always attempted; `secrets` entries only with `includeEnv`. Entries that
 * do not exist on the machine are skipped.
 */
export function targetsFor(platform: string = process.platform): readonly TargetSpec[] {
  return PLATFORM_TARGETS[resolveTargetPlatform(platform)];
}

/** The default targets of the platform this process runs on. */
export const DEFAULT_TARGETS: readonly TargetSpec[] = targetsFor();

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
 * VS Code settings under `~/Library` or `AppData` are still collected). On macOS, merely
 * listing the user folders triggers the "Terminal would like to access your Documents folder"
 * permission prompts; on Windows, `AppData` is enormous and the legacy junctions
 * (`Application Data`, `Local Settings`) fail with EPERM; `OneDrive` may be cloud-only.
 * One flat list keeps the scan identical on every platform.
 */
export const ENV_SCAN_SKIPPED_FOLDERS: readonly string[] = [
  // macOS (and the XDG user directories that share these names on Linux)
  "Library",
  "Desktop",
  "Documents",
  "Downloads",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  // Linux
  "Videos",
  "Templates",
  "snap",
  // Windows
  "AppData",
  "Application Data",
  "Local Settings",
  "OneDrive",
  "Contacts",
  "Favorites",
  "Links",
  "Saved Games",
  "Searches",
  "3D Objects",
];

/** `.env` itself and `.env.<anything>`. */
export const ENV_FILE_NAME = ".env";
export const ENV_FILE_PREFIX = ".env.";

// ---------------------------------------------------------------------------------------------
// Path normalisation used by the rules
// ---------------------------------------------------------------------------------------------

/** Paths are `/`-separated internally; a stray `\` (a Windows spelling) is treated the same. */
const PATH_SEPARATORS = /[\\/]/;
const BACKSLASH = /\\/g;
const LEADING_DOT_SLASH = /^\.\//;
const TRAILING_SLASHES = /\/+$/;

function segmentsOf(relPath: string): string[] {
  return relPath.split(PATH_SEPARATORS);
}

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
  const segments = segmentsOf(relPath);

  if (segments.some((s) => HARD_EXCLUDED.has(s) || COLLECTION_ARTIFACT_PATTERN.test(s))) {
    return true;
  }
  if (isMacOsCachePath(segments)) return true;

  return isPrivateKeyPath(segments);
}

/**
 * User excludes from `~/.dotfilesrc.toml`: a bare name matches any path segment, an entry
 * containing a separator matches that home-relative path and everything under it.
 */
export interface ExcludeRules {
  readonly names: ReadonlySet<string>;
  readonly paths: readonly string[];
}

export function compileExcludes(entries: readonly string[]): ExcludeRules {
  const names = new Set<string>();
  const paths: string[] = [];

  for (const raw of entries) {
    const entry = raw
      .replace(BACKSLASH, "/")
      .replace(LEADING_DOT_SLASH, "")
      .replace(TRAILING_SLASHES, "");
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

  const segments = segmentsOf(relPath);
  if (segments.some((segment) => rules.names.has(segment))) return true;
  const posixPath = segments.join("/");
  return rules.paths.some((prefix) => posixPath === prefix || posixPath.startsWith(`${prefix}/`));
}
