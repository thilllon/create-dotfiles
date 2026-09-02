import { describe, expect, it } from "vitest";
import {
  compileExcludes,
  DEFAULT_TARGETS,
  HARD_EXCLUDED_DIR_NAMES,
  isEnvFile,
  isExcluded,
  isHardExcluded,
} from "./targets";

describe("DEFAULT_TARGETS", () => {
  const paths = DEFAULT_TARGETS.map((t) => t.path);

  it("lists VS Code and Cursor user files at both the macOS and Linux paths", () => {
    for (const editor of ["Code", "Cursor"]) {
      for (const file of ["settings.json", "keybindings.json", "snippets"]) {
        expect(paths).toContain(`Library/Application Support/${editor}/User/${file}`);
        expect(paths).toContain(`.config/${editor}/User/${file}`);
      }
    }
  });

  it("covers the shell, git, editor, terminal, tool and macOS targets", () => {
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
      ".tmux.conf",
      ".config/tmux",
      ".config/starship.toml",
      ".config/alacritty",
      ".config/kitty",
      ".config/wezterm",
      ".config/ghostty",
      ".config/fish",
      ".config/mise",
      ".tool-versions",
      ".editorconfig",
      ".config/gh/config.yml",
      ".config/htop",
      ".config/bat",
      ".config/lazygit",
      ".config/zellij",
      ".hammerspoon",
      ".config/karabiner",
      ".skhdrc",
      ".yabairc",
      ".Brewfile",
      "Brewfile",
      ".ssh/config",
      ".gnupg/gpg.conf",
      ".gnupg/gpg-agent.conf",
      ".aws/config",
    ]) {
      expect(DEFAULT_TARGETS.find((t) => t.path === path)?.group).toBe("core");
    }
  });

  it("puts credential files in the secrets group, never in core", () => {
    for (const path of [".npmrc", ".yarnrc", ".netrc", ".aws/credentials", ".docker/config.json"]) {
      expect(DEFAULT_TARGETS.find((t) => t.path === path)?.group).toBe("secrets");
    }
  });

  it("has no duplicate paths and a category on every entry", () => {
    expect(new Set(paths).size).toBe(paths.length);
    expect(DEFAULT_TARGETS.every((t) => t.category.length > 0)).toBe(true);
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
});
