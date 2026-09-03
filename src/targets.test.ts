import { describe, expect, it } from "vitest";
import {
  COMMON_TARGET_CATEGORIES,
  COMMON_TARGETS,
  compileExcludes,
  DEFAULT_TARGETS,
  EDITOR_USER_FILES,
  ENV_SCAN_SKIPPED_FOLDERS,
  HARD_EXCLUDED_DIR_NAMES,
  isEnvFile,
  isExcluded,
  isHardExcluded,
  PLATFORM_TARGET_CATEGORIES,
  PLATFORM_TARGETS,
  resolveTargetPlatform,
  type TargetPlatform,
  type TargetSpec,
  targetsFor,
} from "./targets";

const PLATFORMS: TargetPlatform[] = ["darwin", "linux", "win32"];
const pathsOf = (specs: readonly TargetSpec[]) => specs.map((t) => t.path);

describe("targetsFor", () => {
  it("maps process.platform values onto darwin, linux and win32, defaulting to linux", () => {
    expect(resolveTargetPlatform("darwin")).toBe("darwin");
    expect(resolveTargetPlatform("win32")).toBe("win32");
    expect(resolveTargetPlatform("linux")).toBe("linux");
    for (const other of ["freebsd", "openbsd", "sunos", "aix", "android", "haiku", ""]) {
      expect(resolveTargetPlatform(other)).toBe("linux");
    }
    expect(resolveTargetPlatform()).toBe(resolveTargetPlatform(process.platform));
  });

  it("DEFAULT_TARGETS is the list for the platform this process runs on", () => {
    expect(DEFAULT_TARGETS).toBe(targetsFor(process.platform));
    expect(targetsFor()).toBe(DEFAULT_TARGETS);
    expect(targetsFor("plan9")).toBe(PLATFORM_TARGETS.linux);
  });

  it.each(PLATFORMS)("%s: contains every common target and the secrets group", (platform) => {
    const paths = pathsOf(targetsFor(platform));
    for (const spec of COMMON_TARGETS) {
      expect(targetsFor(platform)).toContainEqual(spec);
    }
    for (const path of [
      ".zshrc",
      ".zshenv",
      ".zprofile",
      ".bashrc",
      ".bash_profile",
      ".profile",
      ".inputrc",
      ".gitconfig",
      ".gitignore_global",
      ".gitattributes_global",
      ".vimrc",
      ".ideavimrc",
      ".config/nvim",
      ".editorconfig",
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
      ".config/mise",
      ".tool-versions",
      ".config/gh/config.yml",
      ".config/htop",
      ".config/bat",
      ".config/lazygit",
      ".ssh/config",
      ".gnupg/gpg.conf",
      ".gnupg/gpg-agent.conf",
      ".aws/config",
    ]) {
      expect(targetsFor(platform).find((t) => t.path === path)?.group).toBe("core");
    }
    for (const path of [".npmrc", ".yarnrc", ".netrc", ".aws/credentials", ".docker/config.json"]) {
      expect(targetsFor(platform).find((t) => t.path === path)?.group).toBe("secrets");
    }
    expect(paths.length).toBeGreaterThan(COMMON_TARGETS.length);
  });

  it.each(PLATFORMS)(
    "%s: has no duplicate paths, a category on every entry, / separators",
    (platform) => {
      const paths = pathsOf(targetsFor(platform));
      expect(new Set(paths).size).toBe(paths.length);
      expect(targetsFor(platform).every((t) => t.category.length > 0)).toBe(true);
      expect(paths.filter((p) => p.includes("\\") || p.startsWith("/") || p.endsWith("/"))).toEqual(
        []
      );
    }
  );

  it("darwin lists the Library editor paths and the macOS tools, and nothing from Linux or Windows", () => {
    const paths = pathsOf(targetsFor("darwin"));
    for (const editor of ["Code", "Cursor"]) {
      for (const file of EDITOR_USER_FILES) {
        expect(paths).toContain(`Library/Application Support/${editor}/User/${file}`);
        expect(paths).not.toContain(`.config/${editor}/User/${file}`);
        expect(paths).not.toContain(`AppData/Roaming/${editor}/User/${file}`);
      }
    }
    for (const path of [
      ".hammerspoon",
      ".config/karabiner",
      ".skhdrc",
      ".yabairc",
      ".Brewfile",
      "Brewfile",
    ]) {
      expect(targetsFor("darwin").find((t) => t.path === path)).toMatchObject({
        group: "core",
        category: "macOS",
      });
    }
    expect(paths.some((p) => p.startsWith("AppData/"))).toBe(false);
    expect(paths).not.toContain(".config/i3");
    expect(paths).not.toContain(".wslconfig");
  });

  it("linux lists the .config editor paths (Code, Code - OSS, VSCodium, Cursor) and the desktop tools, nothing from macOS or Windows", () => {
    const paths = pathsOf(targetsFor("linux"));
    for (const base of [
      ".config/Code",
      ".config/Code - OSS",
      ".config/VSCodium",
      ".config/Cursor",
    ]) {
      for (const file of EDITOR_USER_FILES) expect(paths).toContain(`${base}/User/${file}`);
    }
    for (const path of [
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
    ]) {
      expect(targetsFor("linux").find((t) => t.path === path)).toMatchObject({
        group: "core",
        category: "Linux",
      });
    }
    expect(paths.some((p) => p.startsWith("Library/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("AppData/"))).toBe(false);
    expect(paths).not.toContain(".hammerspoon");
    expect(paths).not.toContain(".wslconfig");
  });

  it("win32 lists the AppData editor paths and the Windows tools with / separators, nothing from macOS or Linux", () => {
    const paths = pathsOf(targetsFor("win32"));
    for (const editor of ["Code", "Cursor"]) {
      for (const file of EDITOR_USER_FILES) {
        expect(paths).toContain(`AppData/Roaming/${editor}/User/${file}`);
      }
    }
    for (const path of [
      "AppData/Local/nvim",
      "AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
      "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
      "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1",
      "AppData/Roaming/alacritty",
      ".wslconfig",
    ]) {
      expect(targetsFor("win32").find((t) => t.path === path)).toMatchObject({
        group: "core",
        category: "Windows",
      });
    }
    // Neovim's XDG location and the .config terminal emulator files are read on Windows too.
    expect(paths).toContain(".config/nvim");
    expect(paths).toContain(".config/wezterm");
    expect(paths).toContain(".wezterm.lua");
    expect(paths.some((p) => p.startsWith("Library/"))).toBe(false);
    expect(paths).not.toContain(".config/Code/User/settings.json");
    expect(paths).not.toContain(".hammerspoon");
    expect(paths).not.toContain(".config/i3");
  });

  it("attempts common targets first, then the platform's own, then secrets", () => {
    for (const platform of PLATFORMS) {
      const categories = [...new Set(targetsFor(platform).map((t) => t.category))];
      expect(categories.slice(0, COMMON_TARGET_CATEGORIES.length)).toEqual(
        COMMON_TARGET_CATEGORIES.map((c) => c.category)
      );
      expect(categories.at(-1)).toBe("Secrets");
      expect(categories).toEqual(
        expect.arrayContaining(PLATFORM_TARGET_CATEGORIES[platform].map((c) => c.category))
      );
    }
  });
});

describe("ENV_SCAN_SKIPPED_FOLDERS", () => {
  it("covers the macOS user folders, the Linux XDG folders and snap, and the Windows profile folders", () => {
    expect(ENV_SCAN_SKIPPED_FOLDERS).toEqual(
      expect.arrayContaining([
        "Library",
        "Desktop",
        "Documents",
        "Downloads",
        "Movies",
        "Music",
        "Pictures",
        "Public",
        "Videos",
        "Templates",
        "snap",
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
      ])
    );
    expect(new Set(ENV_SCAN_SKIPPED_FOLDERS).size).toBe(ENV_SCAN_SKIPPED_FOLDERS.length);
    // Case-only duplicates would collide on macOS and Windows file systems.
    const lower = ENV_SCAN_SKIPPED_FOLDERS.map((name) => name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });
});

describe("isEnvFile", () => {
  it("matches .env and .env.* only", () => {
    expect(isEnvFile(".env")).toBe(true);
    expect(isEnvFile(".env.local")).toBe(true);
    expect(isEnvFile(".env.production.example")).toBe(true);
    expect(isEnvFile(".envrc")).toBe(false);
    expect(isEnvFile("env")).toBe(false);
    expect(isEnvFile("my.env")).toBe(false);
  });
});

describe("isHardExcluded", () => {
  it.each([
    "node_modules",
    "projects/app/node_modules/.env",
    ".config/app/.git/config",
    ".config/nvim/plugged/x/.hg/store",
    "a/.svn/b",
    "x/__pycache__/y.pyc",
    ".venv/bin/python",
    "proj/venv/lib",
    ".cache/pip/x",
    ".config/Code/Cache/data",
    ".config/Code/CachedData/x",
    ".config/Code/Code Cache/x",
    ".config/Code/GPUCache/x",
    ".config/Code/Service Worker/x",
    ".config/x/Caches/y",
    ".npm/_cacache/x",
    ".pnpm-store/v3/x",
    ".yarn/cache/x",
    ".cargo/registry/x",
    ".rustup/toolchains/x",
    ".gradle/caches/x",
    ".m2/repository/x",
    ".Trash/file",
    ".local/share/Trash/file",
    ".DS_Store",
    ".config/app/.DS_Store",
    "Library/Caches/com.apple.x",
    "Library/Application Support/Code/Cache/x",
    "Library/Application Support/Cursor/Cache Storage/x",
    "Library/Application Support/Code/CachedData/x",
  ])("excludes %s", (path) => {
    expect(isHardExcluded(path)).toBe(true);
  });

  it.each([
    ".zshrc",
    ".config/nvim/init.lua",
    ".config/Code/User/settings.json",
    "Library/Application Support/Code/User/settings.json",
    "Library/Application Support/Code/User/snippets/ts.json",
    "Library/Preferences/x.plist",
    ".config/app/cache-notes.md",
    "projects/node_modules_docs/readme.md",
    ".gitconfig",
    ".ssh",
    ".gnupg",
  ])("keeps %s", (path) => {
    expect(isHardExcluded(path)).toBe(false);
  });

  it("covers every configured directory name at any depth", () => {
    for (const name of HARD_EXCLUDED_DIR_NAMES) {
      expect(isHardExcluded(name)).toBe(true);
      expect(isHardExcluded(`a/b/${name}/c`)).toBe(true);
    }
  });

  describe("private keys", () => {
    it.each([
      ".ssh/id_rsa",
      ".ssh/id_ed25519",
      ".ssh/known_hosts",
      ".ssh/authorized_keys",
      ".ssh/keys/deploy",
      ".gnupg/private-keys-v1.d/ABC.key",
      ".gnupg/pubring.kbx",
      ".gnupg/pubring.kbx~",
      ".gnupg/trustdb.gpg",
      ".gnupg/secring.gpg",
      ".gnupg/backup/pubring.gpg",
    ])("never allows %s", (path) => {
      expect(isHardExcluded(path)).toBe(true);
    });

    it.each([
      ".ssh/config",
      ".ssh/id_ed25519.pub",
      ".ssh/keys/deploy.pub",
      ".gnupg/gpg.conf",
      ".gnupg/gpg-agent.conf",
    ])("allows %s", (path) => {
      expect(isHardExcluded(path)).toBe(false);
    });
  });

  it("never re-collects a previous collection folder or archive", () => {
    expect(isHardExcluded("dotfiles-20260902-110342")).toBe(true);
    expect(isHardExcluded("dotfiles-20260902-110342/.zshrc")).toBe(true);
    expect(isHardExcluded("backups/dotfiles-20260902-110342.zip")).toBe(true);
    expect(isHardExcluded("dotfiles-20260902-110342.tar.gz")).toBe(true);
    expect(isHardExcluded("dotfiles-notes/todo.md")).toBe(false);
  });
});

describe("isExcluded with user rules", () => {
  it("matches bare names against any path segment", () => {
    const rules = compileExcludes(["secret", ".zshrc"]);
    expect(isExcluded(".config/app/secret/x.toml", rules)).toBe(true);
    expect(isExcluded(".zshrc", rules)).toBe(true);
    expect(isExcluded(".config/app/secrets/x.toml", rules)).toBe(false);
  });

  it("matches path entries as whole-segment prefixes only", () => {
    const rules = compileExcludes([".config/nvim"]);
    expect(isExcluded(".config/nvim", rules)).toBe(true);
    expect(isExcluded(".config/nvim/init.lua", rules)).toBe(true);
    expect(isExcluded(".config/nvim-extra/x", rules)).toBe(false);
    expect(isExcluded("nvim/init.lua", rules)).toBe(false);
  });

  it("normalizes ./ prefixes and trailing slashes", () => {
    const rules = compileExcludes(["./.config/app/", "tmp/"]);
    expect(rules.paths).toEqual([".config/app"]);
    expect(isExcluded(".config/app/x", rules)).toBe(true);
    expect(isExcluded("a/tmp/x", rules)).toBe(true);
  });

  it("still applies the hard excludes when user rules are given", () => {
    const rules = compileExcludes(["nothing"]);
    expect(isExcluded(".ssh/id_rsa", rules)).toBe(true);
    expect(isExcluded("x/node_modules/y", rules)).toBe(true);
    expect(isExcluded(".zshrc", rules)).toBe(false);
  });

  it("applies only the hard excludes without rules", () => {
    expect(isExcluded(".zshrc")).toBe(false);
    expect(isExcluded(".cache/x")).toBe(true);
  });

  it("matches by segment whichever separator the path or the rule was written with", () => {
    const rules = compileExcludes([".config\\app\\tmp", "secret", "./work\\"]);
    expect(rules.paths).toEqual([".config/app/tmp"]);
    expect(rules.names.has("secret")).toBe(true);
    expect(rules.names.has("work")).toBe(true);
    expect(isExcluded(".config/app/tmp/x", rules)).toBe(true);
    expect(isExcluded(".config\\app\\tmp\\x", rules)).toBe(true);
    expect(isExcluded("a\\secret\\b", rules)).toBe(true);
    expect(isExcluded(".config/app/tmp-other/x", rules)).toBe(false);
    expect(isHardExcluded("projects\\app\\node_modules\\x")).toBe(true);
    expect(isHardExcluded(".ssh\\id_rsa")).toBe(true);
    expect(isHardExcluded("Library\\Caches\\x")).toBe(true);
  });
});
