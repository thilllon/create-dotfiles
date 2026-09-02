export type TargetGroup = "core" | "secrets" | "config-all" | "custom";

export interface TargetSpec {
  /** Path relative to the home directory, with `/` separators. */
  path: string;
  group: "core" | "secrets";
  /** Heading used when listing which targets were found on the machine. */
  category: string;
}

function core(category: string, ...paths: string[]): TargetSpec[] {
  return paths.map((path) => ({ path, group: "core", category }));
}

function secrets(category: string, ...paths: string[]): TargetSpec[] {
  return paths.map((path) => ({ path, group: "secrets", category }));
}

/** VS Code and Cursor keep the same three user files under `<base>/User/`. */
function editorUserFiles(base: string): string[] {
  return ["settings.json", "keybindings.json", "snippets"].map((file) => `${base}/User/${file}`);
}

/**
 * What gets collected. `core` entries are always attempted; `secrets` entries only with
 * `includeEnv`. Entries that do not exist on the machine are skipped.
 */
export const DEFAULT_TARGETS: readonly TargetSpec[] = [
  ...core(
    "Shell",
    ".zshrc",
    ".zshenv",
    ".zprofile",
    ".bashrc",
    ".bash_profile",
    ".profile",
    ".inputrc"
  ),
  ...core("Git", ".gitconfig", ".gitignore_global", ".gitattributes_global"),
  ...core("Editors", ".vimrc", ".ideavimrc", ".config/nvim", ".editorconfig"),
  ...core(
    "VS Code",
    ...editorUserFiles("Library/Application Support/Code"),
    ...editorUserFiles(".config/Code")
  ),
  ...core(
    "Cursor",
    ...editorUserFiles("Library/Application Support/Cursor"),
    ...editorUserFiles(".config/Cursor")
  ),
  ...core(
    "Terminal",
    ".tmux.conf",
    ".config/tmux",
    ".config/starship.toml",
    ".config/alacritty",
    ".config/kitty",
    ".config/wezterm",
    ".config/ghostty",
    ".config/fish",
    ".config/zellij"
  ),
  ...core(
    "Tools",
    ".config/mise",
    ".tool-versions",
    ".config/gh/config.yml",
    ".config/htop",
    ".config/bat",
    ".config/lazygit"
  ),
  ...core(
    "macOS",
    ".hammerspoon",
    ".config/karabiner",
    ".skhdrc",
    ".yabairc",
    ".Brewfile",
    "Brewfile"
  ),
  ...core(
    "SSH / GPG / AWS",
    ".ssh/config",
    ".gnupg/gpg.conf",
    ".gnupg/gpg-agent.conf",
    ".aws/config"
  ),
  ...secrets("Secrets", ".npmrc", ".yarnrc", ".netrc", ".aws/credentials", ".docker/config.json"),
];

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

/** `dotfiles-YYYYMMDD-HHMMSS`, the name of every collection folder this tool writes. */
export const COLLECTION_NAME_PATTERN = /^dotfiles-\d{8}-\d{6}$/;

/** A collection folder or one of its archives; previous runs are never collected again. */
const COLLECTION_ARTIFACT_PATTERN = /^dotfiles-\d{8}-\d{6}(\.zip|\.tar\.gz)?$/;

export function isEnvFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

/**
 * Private keys are never copied, whatever the options: everything under `.ssh` except
 * `config` and `*.pub`, and GnuPG's private key store, keyrings and key boxes.
 */
function isPrivateKeyPath(segments: readonly string[]): boolean {
  if (segments.length < 2) return false;

  if (segments[0] === ".ssh") {
    const rest = segments.slice(1).join("/");
    return rest !== "config" && !rest.endsWith(".pub");
  }

  if (segments[0] === ".gnupg") {
    if (segments[1] === "private-keys-v1.d") return true;
    return /\.(gpg|kbx)~?$/.test(segments[segments.length - 1]);
  }

  return false;
}

/** The excludes that apply to everything, including opted-in groups and config includes. */
export function isHardExcluded(relPath: string): boolean {
  const segments = relPath.split("/");

  if (segments.some((s) => HARD_EXCLUDED.has(s) || COLLECTION_ARTIFACT_PATTERN.test(s))) {
    return true;
  }

  if (segments[0] === "Library") {
    if (segments[1] === "Caches") return true;
    if (
      segments[1] === "Application Support" &&
      segments.length >= 4 &&
      segments[3].startsWith("Cache")
    ) {
      return true;
    }
  }

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
    const entry = raw.replace(/^\.\//, "").replace(/\/+$/, "");
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
