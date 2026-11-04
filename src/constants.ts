/**
 * Every constant of the package: default targets, never-copied rules, `.env` scan settings,
 * output formats, zip password policy and the fixed strings and patterns the modules share.
 * Modules import from here; nothing in this file reads the disk or the environment.
 */
import type { OutputFormat } from "./config";
import type { SelectOption } from "./interactive";
import type { TargetCategory, TargetGroup, TargetPlatform, TargetSpec } from "./targets";

// ---------------------------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------------------------

export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
/** Units `Reporter.bytes` steps through after bytes. */
export const BYTE_UNITS: readonly string[] = ["KB", "MB", "GB", "TB"];

// ---------------------------------------------------------------------------------------------
// Options and the config file
// ---------------------------------------------------------------------------------------------

/** The optional config file in the home directory; it is never created. */
export const CONFIG_FILE = ".dotfilesrc.toml";

export const DEFAULT_MAX_FILE_SIZE_MB = 10;
export const DEFAULT_FORMATS: readonly OutputFormat[] = ["folder"];

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["folder", "zip", "tar"];

/** Accepted spellings of each output format; `tar.gz` and `tgz` mean `tar`. */
export const FORMAT_ALIASES: Readonly<Record<string, OutputFormat>> = {
  folder: "folder",
  zip: "zip",
  tar: "tar",
  "tar.gz": "tar",
  tgz: "tar",
};

/** The `[settings]` booleans of the config file and the option each one sets. */
export const CONFIG_BOOLEAN_SETTINGS = [
  ["include_env", "includeEnv"],
  ["include_config", "includeConfig"],
  ["encrypt_zip", "encryptZip"],
] as const;

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/** Paths are `/`-separated internally; a stray `\` (a Windows spelling) is treated the same. */
export const PATH_SEPARATORS = /[\\/]/;
export const BACKSLASHES = /\\/g;
export const LEADING_DOT_SLASH = /^\.\//;
export const TRAILING_SLASHES = /\/+$/;
/** Trailing slashes after at least one character, so `/` alone is kept. */
export const TRAILING_SLASHES_AFTER_NAME = /(.)\/+$/;

// ---------------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------------

export const COLLECTION_NAME_PREFIX = "dotfiles-";

/** `dotfiles-YYYYMMDD-HHMMSS`, the name of every collection folder this tool writes. */
export const COLLECTION_NAME_PATTERN = /^dotfiles-\d{8}-\d{6}$/;

/** A collection folder or one of its archives; previous runs are never collected again. */
export const COLLECTION_ARTIFACT_PATTERN = /^dotfiles-\d{8}-\d{6}(\.zip|\.tar\.gz)?$/;

/** Restore refuses these: archives have to be extracted first. */
export const ARCHIVE_PATTERN = /\.(zip|tar\.gz|tgz|tar)$/i;

/** Prefix of the private staging directory an encrypted zip without the folder uses. */
export const STAGING_TEMP_PREFIX = "create-dotfiles-";

/** `rmSync` retries: on Windows an archiver or indexer may still hold a staged file open. */
export const RM_MAX_RETRIES = 3;

/** zip.js `encryptionStrength`: 3 is AES-256. */
export const AES_256_STRENGTH = 3;

/** The permission bits of a file mode, as stored in a zip entry. */
export const UNIX_PERMISSION_BITS = 0o7777;

// ---------------------------------------------------------------------------------------------
// Groups and categories
// ---------------------------------------------------------------------------------------------

/** The order groups are counted and reported in. */
export const GROUP_ORDER: readonly TargetGroup[] = ["core", "custom", "secrets", "config-all"];

/** `target` of files found by the home-directory `.env` scan rather than by a listed path. */
export const ENV_SCAN_TARGET = ".env scan";
export const CUSTOM_CATEGORY = "From ~/.dotfilesrc.toml";
export const CONFIG_ALL_CATEGORY = "Everything under ~/.config";
/** The directory the `config-all` group collects. */
export const CONFIG_DIR = ".config";

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

/** `<base>/User/settings.json` and friends for every listed base directory. */
function editorUserFiles(bases: readonly string[]): string[] {
  return bases.flatMap((base) => EDITOR_USER_FILES.map((file) => `${base}/User/${file}`));
}

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
    { category: "VS Code", group: "core", paths: editorUserFiles(DARWIN_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(DARWIN_CURSOR_USER_DIRS) },
    { category: "macOS", group: "core", paths: DARWIN_TARGETS },
  ],
  linux: [
    { category: "VS Code", group: "core", paths: editorUserFiles(LINUX_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(LINUX_CURSOR_USER_DIRS) },
    { category: "Linux", group: "core", paths: LINUX_TARGETS },
  ],
  win32: [
    { category: "VS Code", group: "core", paths: editorUserFiles(WIN32_VSCODE_USER_DIRS) },
    { category: "Cursor", group: "core", paths: editorUserFiles(WIN32_CURSOR_USER_DIRS) },
    { category: "Windows", group: "core", paths: WIN32_TARGETS },
  ],
};

function toSpecs({ category, group, paths }: TargetCategory): TargetSpec[] {
  return paths.map((path) => ({ path, group, category }));
}

/** The targets shared by every platform: the common categories plus the secrets group. */
export const COMMON_TARGETS: readonly TargetSpec[] = [
  ...COMMON_TARGET_CATEGORIES,
  ...SECRET_TARGET_CATEGORIES,
].flatMap(toSpecs);

function platformTargets(platform: TargetPlatform): TargetSpec[] {
  return [
    ...COMMON_TARGET_CATEGORIES,
    ...PLATFORM_TARGET_CATEGORIES[platform],
    ...SECRET_TARGET_CATEGORIES,
  ].flatMap(toSpecs);
}

/** The full default list per platform: common first, then platform-specific, then secrets. */
export const PLATFORM_TARGETS: Readonly<Record<TargetPlatform, readonly TargetSpec[]>> = {
  darwin: platformTargets("darwin"),
  linux: platformTargets("linux"),
  win32: platformTargets("win32"),
};

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
export const GNUPG_PRIVATE_KEYS_DIR = "private-keys-v1.d"; // gitleaks:allow (a directory name)
export const GNUPG_KEYRING_PATTERN = /\.(gpg|kbx)~?$/;

// ---------------------------------------------------------------------------------------------
// .env scan
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
// Zip password
// ---------------------------------------------------------------------------------------------

/**
 * The zip is encrypted with WinZip AES-256, whose key derivation is fixed by the format at
 * PBKDF2-HMAC-SHA1 with 1000 iterations: a single GPU tries tens of millions of passwords a
 * second. The password is therefore the whole defence. 15 is the NIST SP 800-63B-4 minimum
 * for a password that is the only factor.
 */
export const MIN_ZIP_PASSWORD_LENGTH = 15;

/** 7-Zip refuses longer passwords, so a longer one would make the zip impossible to open there. */
export const MAX_ZIP_PASSWORD_LENGTH = 99;

/** 7-Zip (p7zip in particular) rejects anything but printable ASCII. */
export const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** Scripted runs read the password from one of these; it is never taken from argv. */
export const ZIP_PASSWORD_ENV = "CREATE_DOTFILES_ZIP_PASSWORD";
export const ZIP_PASSWORD_FILE_ENV = "CREATE_DOTFILES_ZIP_PASSWORD_FILE";

/**
 * Crockford's base32 alphabet: no I, L, O or U, so a password copied from paper or read aloud
 * cannot be mistyped as a look-alike. Six groups of five symbols are 150 bits.
 */
export const GENERATED_PASSWORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // gitleaks:allow (an alphabet)
export const GENERATED_PASSWORD_GROUPS = 6;
export const GENERATED_PASSWORD_GROUP_LENGTH = 5;

/** A UTF-8 byte order mark at the start of a password file, as Windows editors write it. */
export const UTF8_BOM = /^﻿/;

// ---------------------------------------------------------------------------------------------
// Interactive flow
// ---------------------------------------------------------------------------------------------

/** Returned by a `Prompter` when the user aborts (Ctrl+C / Esc). */
export const CANCEL: unique symbol = Symbol("create-dotfiles.cancel");

export const FORMAT_OPTIONS: readonly SelectOption<OutputFormat>[] = [
  { value: "folder", label: "folder", hint: "dotfiles-YYYYMMDD-HHMMSS/" },
  { value: "zip", label: "zip", hint: "dotfiles-YYYYMMDD-HHMMSS.zip" },
  { value: "tar", label: "tar.gz", hint: "dotfiles-YYYYMMDD-HHMMSS.tar.gz" },
];

export const ZIP_PROTECTION_LABEL = " (AES-256, password-protected)";
