import { describe, expect, it } from "vitest";
import {
  COMMON_TARGET_CATEGORIES,
  COMMON_TARGETS,
  EDITOR_USER_FILES,
  ENV_SCAN_SKIPPED_FOLDERS,
  HARD_EXCLUDED_DIR_NAMES,
  PLATFORM_TARGET_CATEGORIES,
} from "./constants";
import { ExcludeRules, type TargetPlatform, Targets, type TargetSpec } from "./targets";

const PLATFORMS: TargetPlatform[] = ["darwin", "linux", "win32"];
const pathsOf = (specs: readonly TargetSpec[]) => specs.map((t) => t.path);

describe("Targets.forPlatform", () => {
  it("maps process.platform values onto darwin, linux and win32, defaulting to linux", () => {
    expect(Targets.resolvePlatform("darwin")).toBe("darwin");
    expect(Targets.resolvePlatform("win32")).toBe("win32");
    expect(Targets.resolvePlatform("linux")).toBe("linux");
    for (const other of ["freebsd", "openbsd", "sunos", "aix", "android", "haiku", ""]) {
      expect(Targets.resolvePlatform(other)).toBe("linux");
    }
    expect(Targets.resolvePlatform()).toBe(Targets.resolvePlatform(process.platform));
  });

  it.each(PLATFORMS)("%s: contains every common target and the secrets group", (platform) => {
    const paths = pathsOf(Targets.forPlatform(platform));
    for (const spec of COMMON_TARGETS) {
      expect(Targets.forPlatform(platform)).toContainEqual(spec);
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
      expect(Targets.forPlatform(platform).find((t) => t.path === path)?.group).toBe("core");
    }
    for (const path of [".npmrc", ".yarnrc", ".netrc", ".aws/credentials", ".docker/config.json"]) {
      expect(Targets.forPlatform(platform).find((t) => t.path === path)?.group).toBe("secrets");
    }
    expect(paths.length).toBeGreaterThan(COMMON_TARGETS.length);
  });

  it.each(PLATFORMS)(
    "%s: has no duplicate paths, a category on every entry, / separators",
    (platform) => {
      const paths = pathsOf(Targets.forPlatform(platform));
      expect(new Set(paths).size).toBe(paths.length);
      expect(Targets.forPlatform(platform).every((t) => t.category.length > 0)).toBe(true);
      expect(paths.filter((p) => p.includes("\\") || p.startsWith("/") || p.endsWith("/"))).toEqual(
        []
      );
    }
  );

  it("darwin lists the Library editor paths and the macOS tools, and nothing from Linux or Windows", () => {
    const paths = pathsOf(Targets.forPlatform("darwin"));
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
      expect(Targets.forPlatform("darwin").find((t) => t.path === path)).toMatchObject({
        group: "core",
        category: "macOS",
      });
    }
    expect(paths.some((p) => p.startsWith("AppData/"))).toBe(false);
    expect(paths).not.toContain(".config/i3");
    expect(paths).not.toContain(".wslconfig");
  });

  it("linux lists the .config editor paths (Code, Code - OSS, VSCodium, Cursor) and the desktop tools, nothing from macOS or Windows", () => {
    const paths = pathsOf(Targets.forPlatform("linux"));
    for (const base of [
      ".config/Code",
      ".config/Code - OSS",
      ".config/VSCodium",
      ".config/Cursor",
    ]) {
      for (const file of EDITOR_USER_FILES) {
        expect(paths).toContain(`${base}/User/${file}`);
      }
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
      expect(Targets.forPlatform("linux").find((t) => t.path === path)).toMatchObject({
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
    const paths = pathsOf(Targets.forPlatform("win32"));
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
      expect(Targets.forPlatform("win32").find((t) => t.path === path)).toMatchObject({
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
      const categories = [...new Set(Targets.forPlatform(platform).map((t) => t.category))];
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

describe("Targets.isEnvFile", () => {
  it("matches .env and .env.* only", () => {
    expect(Targets.isEnvFile(".env")).toBe(true);
    expect(Targets.isEnvFile(".env.local")).toBe(true);
    expect(Targets.isEnvFile(".env.production.example")).toBe(true);
    expect(Targets.isEnvFile(".envrc")).toBe(false);
    expect(Targets.isEnvFile("env")).toBe(false);
    expect(Targets.isEnvFile("my.env")).toBe(false);
  });
});

describe("Targets.isHardExcluded", () => {
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
    expect(Targets.isHardExcluded(path)).toBe(true);
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
    expect(Targets.isHardExcluded(path)).toBe(false);
  });

  it("covers every configured directory name at any depth", () => {
    for (const name of HARD_EXCLUDED_DIR_NAMES) {
      expect(Targets.isHardExcluded(name)).toBe(true);
      expect(Targets.isHardExcluded(`a/b/${name}/c`)).toBe(true);
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
      expect(Targets.isHardExcluded(path)).toBe(true);
    });

    it.each([
      ".ssh/config",
      ".ssh/id_ed25519.pub",
      ".ssh/keys/deploy.pub",
      ".gnupg/gpg.conf",
      ".gnupg/gpg-agent.conf",
    ])("allows %s", (path) => {
      expect(Targets.isHardExcluded(path)).toBe(false);
    });
  });

  it("never re-collects a previous collection folder or archive", () => {
    expect(Targets.isHardExcluded("dotfiles-20260902-110342")).toBe(true);
    expect(Targets.isHardExcluded("dotfiles-20260902-110342/.zshrc")).toBe(true);
    expect(Targets.isHardExcluded("backups/dotfiles-20260902-110342.zip")).toBe(true);
    expect(Targets.isHardExcluded("dotfiles-20260902-110342.tar.gz")).toBe(true);
    expect(Targets.isHardExcluded("dotfiles-notes/todo.md")).toBe(false);
  });
});

describe("ExcludeRules.matches", () => {
  it("matches bare names against any path segment", () => {
    const rules = new ExcludeRules(["secret", ".zshrc"]);
    expect(rules.matches(".config/app/secret/x.toml")).toBe(true);
    expect(rules.matches(".zshrc")).toBe(true);
    expect(rules.matches(".config/app/secrets/x.toml")).toBe(false);
  });

  it("matches path entries as whole-segment prefixes only", () => {
    const rules = new ExcludeRules([".config/nvim"]);
    expect(rules.matches(".config/nvim")).toBe(true);
    expect(rules.matches(".config/nvim/init.lua")).toBe(true);
    expect(rules.matches(".config/nvim-extra/x")).toBe(false);
    expect(rules.matches("nvim/init.lua")).toBe(false);
  });

  it("normalizes ./ prefixes and trailing slashes", () => {
    const rules = new ExcludeRules(["./.config/app/", "tmp/"]);
    expect(rules.paths).toEqual([".config/app"]);
    expect(rules.matches(".config/app/x")).toBe(true);
    expect(rules.matches("a/tmp/x")).toBe(true);
  });

  it("still applies the hard excludes when user rules are given", () => {
    const rules = new ExcludeRules(["nothing"]);
    expect(rules.matches(".ssh/id_rsa")).toBe(true);
    expect(rules.matches("x/node_modules/y")).toBe(true);
    expect(rules.matches(".zshrc")).toBe(false);
  });

  it("applies only the hard excludes without rules", () => {
    const rules = new ExcludeRules();
    expect(rules.matches(".zshrc")).toBe(false);
    expect(rules.matches(".cache/x")).toBe(true);
  });

  it("matches by segment whichever separator the path or the rule was written with", () => {
    const rules = new ExcludeRules([".config\\app\\tmp", "secret", "./work\\"]);
    expect(rules.paths).toEqual([".config/app/tmp"]);
    expect(rules.names.has("secret")).toBe(true);
    expect(rules.names.has("work")).toBe(true);
    expect(rules.matches(".config/app/tmp/x")).toBe(true);
    expect(rules.matches(".config\\app\\tmp\\x")).toBe(true);
    expect(rules.matches("a\\secret\\b")).toBe(true);
    expect(rules.matches(".config/app/tmp-other/x")).toBe(false);
    expect(Targets.isHardExcluded("projects\\app\\node_modules\\x")).toBe(true);
    expect(Targets.isHardExcluded(".ssh\\id_rsa")).toBe(true);
    expect(Targets.isHardExcluded("Library\\Caches\\x")).toBe(true);
  });
});
