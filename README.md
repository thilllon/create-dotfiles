<h1 align="center">create-dotfiles</h1>

<p align="center">
  <strong>One command. Every dotfile you care about, collected into a timestamped folder, zip or tar.gz.</strong><br />
  Secrets stay out unless you say otherwise. No config file required.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/v/create-dotfiles?logo=npm&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/dm/create-dotfiles?logo=npm" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/types/create-dotfiles?logo=typescript&logoColor=white" alt="TypeScript types" /></a>
  <a href="https://github.com/thilllon/create-dotfiles/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/thilllon/create-dotfiles/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/thilllon/create-dotfiles" alt="License" /></a>
</p>

<p align="center">
  <code>npx create-dotfiles</code>
</p>

## See it in action

Run it in a terminal and it walks you through what it found, what it will never touch, and what you want back:

1. Scans your home directory once and shows which known dotfiles exist on this machine, grouped (Shell, Git, Editors, Tools, …).
2. Lists what is **never copied**: `node_modules`, `.git`, caches, SSH/GPG private keys, files over 10 MB.
3. Asks whether to include **secret files** — `.env` files found by the scan (it tells you how many), plus `.npmrc`, `.netrc`, `.aws/credentials`, `.docker/config.json`. Default: no.
4. Asks whether to include **everything under `~/.config`** (with a file count and size). Default: no.
5. Lets you pick output formats — `folder` (preselected), `zip`, `tar.gz` — any combination.
6. Shows the exact output paths and asks to proceed. Cancelling at any step writes nothing.

Scripted, it just does the sensible thing. This is a real run against a home directory with a
symlinked `~/.config/nvim`, a `.env` two levels deep, another `.env` inside `node_modules`, an SSH
key pair and a 20 MB file:

```console
$ npx create-dotfiles --auto --format folder,zip,tar --include-env
Copied 9 files (132 B) from /Users/you
  .zshrc (13 B) [core]
  .gitconfig (20 B) [core]
  .config/nvim/init.lua (8 B) [core]
  .config/nvim/lua/plugins.lua (11 B) [core]
  .tmux.conf (16 B) [core]
  .hammerspoon/init.lua (15 B) [core]
  .ssh/config (13 B) [core]
  .npmrc (27 B) [secrets]
  projects/app/.env (9 B) [secrets]
Per group: core 7, custom 0, secrets 2, config-all 0
Skipped, larger than 10 MB (1):
  .hammerspoon/Spoons/blob.bin (20.0 MB)
Not found (49): .zshenv, .zprofile, .bashrc, ...
Written:
  folder: /Users/you/dotfiles-20260902-150719/
  zip:    /Users/you/dotfiles-20260902-150719.zip
  tar.gz: /Users/you/dotfiles-20260902-150719.tar.gz
```

The symlinked Neovim config came through as real files, `node_modules/pkg/.env` and the private key
did not, and the oversized file was reported rather than silently dropped. Every file keeps its
home-relative path, so the folder is a faithful mirror and the archives restore anywhere.

## Features

|                               |                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **▸ Zero setup**              | No config file needed. Built-in targets cover shells, Git, Vim/Neovim, tmux, terminal emulators, Starship, fish, mise, VS Code and Cursor (macOS and Linux paths), and more.            |
| **▸ Interactive or scripted** | A terminal gets prompts; `--auto` gets defaults. Piped or in CI, it falls back to `--auto` on its own.                                                                                   |
| **▸ Timestamped, faithful**   | `~/dotfiles-YYYYMMDD-HHMMSS/` mirrors home-relative paths. Get a folder, a zip, a tar.gz, or all three in one run.                                                                       |
| **▸ Secrets are opt-in**      | `.env` files (found by a bounded scan), `.npmrc`, `.netrc`, `.aws/credentials`, `.docker/config.json` only with `--include-env`. SSH and GPG private keys are never copied, ever.        |
| **▸ Never copies junk**       | `node_modules`, `.git`, caches, previous collections and files over 10 MB are skipped — and the skips are reported, not hidden.                                                          |
| **▸ Symlinks resolved**       | A stow-style symlinked `~/.config/nvim` is copied as real files, at every level, so nothing in the archive points back at a machine you no longer have.                                 |
| **▸ Safe restore**            | `restore` puts the newest collection back without overwriting anything unless you pass `--force`.                                                                                       |
| **▸ Dry run**                 | `--dry-run` prints exactly what would be copied, with sizes and groups, and writes nothing.                                                                                              |
| **▸ Typed library**           | `import { collect, restore } from "create-dotfiles"` ships with full TypeScript declarations and zero runtime dependencies.                                                             |

## Usage

```shell
npx create-dotfiles                 # interactive
npx create-dotfiles --auto          # defaults: core targets, folder output, secrets excluded
npx create-dotfiles --dry-run       # show the plan, write nothing
npx create-dotfiles restore         # put the newest collection back (never overwrites)
```

Or install it: `npm i -g create-dotfiles` (also `pnpm add -g` / `yarn global add`). Node 22 or newer.

### Flags

Every flag works with `--auto` and, in interactive mode, pre-fills the corresponding question.

| Flag                     | Default   | Effect                                                                                     |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------ |
| `--auto`                 | off       | Run without prompts.                                                                       |
| `--include-env`          | off       | Include the secrets group (`.env` files and the credential files listed above).            |
| `--include-config`       | off       | Include everything under `~/.config`, minus the never-copied rules.                        |
| `--format <list>`        | `folder`  | Comma-separated subset of `folder`, `zip`, `tar` (`tar.gz` and `tgz` are accepted).        |
| `--out <dir>`            | `~`       | Parent directory for the output. `~/` is expanded.                                          |
| `--max-file-size <mb>`   | `10`      | Skip files larger than this; they are listed in the summary.                               |
| `--dry-run`              | off       | Print the plan and the output paths without writing anything.                              |

`--help` and `--version` never read or write anything in your home directory.

### Restore

```shell
npx create-dotfiles restore                          # newest ~/dotfiles-YYYYMMDD-HHMMSS
npx create-dotfiles restore ~/dotfiles-20260902-150719
npx create-dotfiles restore --force                  # overwrite files that already exist
```

Files that already exist are reported as `[SKIP] <path> exists (use --force)`. Restore works from a collection **folder**; extract a zip or tar.gz first.

## What gets collected

**Core (always)** — only the ones that exist on your machine:

- Shell: `.zshrc` `.zshenv` `.zprofile` `.bashrc` `.bash_profile` `.profile` `.inputrc`
- Git: `.gitconfig` `.gitignore_global` `.gitattributes_global`
- Editors: `.vimrc` `.ideavimrc` `.config/nvim`, VS Code and Cursor `settings.json` / `keybindings.json` / `snippets` (both `Library/Application Support/...` and `.config/...`)
- Terminal and tools: `.tmux.conf` `.config/tmux` `.config/starship.toml` `.config/alacritty` `.config/kitty` `.config/wezterm` `.config/ghostty` `.config/fish` `.config/mise` `.tool-versions` `.editorconfig` `.config/gh/config.yml` `.config/htop` `.config/bat` `.config/lazygit` `.config/zellij` `.hammerspoon` `.config/karabiner` `.skhdrc` `.yabairc` `.Brewfile` `Brewfile`
- Non-secret parts of secret-adjacent tools: `.ssh/config` `.gnupg/gpg.conf` `.gnupg/gpg-agent.conf` `.aws/config`

**Secrets (`--include-env`)** — `.npmrc` `.yarnrc` `.netrc` `.aws/credentials` `.docker/config.json`, and every `.env` / `.env.*` found by a scan of your home directory that goes at most four levels deep, never enters the never-copied directories, and does not follow symlinked directories.

**Everything under `~/.config` (`--include-config`)** — after the never-copied rules and the size cap.

**Never copied, regardless of options**

- Directories named `node_modules` `.git` `.hg` `.svn` `__pycache__` `.venv` `venv` `.cache` `Cache` `Caches` `CachedData` `Code Cache` `GPUCache` `Service Worker` `.npm` `.pnpm-store` `.yarn` `.cargo` `.rustup` `.gradle` `.m2` `.Trash` `Trash`, plus `.DS_Store`
- `Library/Caches` and any `Library/Application Support/*/Cache*`
- Private keys: everything in `.ssh/` except `config` and `*.pub`; `.gnupg/private-keys-v1.d`, `.gnupg/*.gpg`, `.gnupg/*.kbx`
- Previous collections (`dotfiles-YYYYMMDD-HHMMSS`, `.zip`, `.tar.gz`), so a secrets scan never re-collects an earlier run
- Files larger than the size cap (default 10 MB)

## Configuration (optional)

If `~/.dotfilesrc.toml` exists it is read; it is never created for you.

```toml
[settings]
include_env = false
include_config = false
formats = ["folder", "zip"]
max_file_size_mb = 10
out = "~/Backups"

[files]
# Extra paths, relative to your home directory.
include = [".config/foo", "work/scripts"]
# Paths or directory names to add to the excludes.
exclude = [".config/kitty", "Snapshots"]
```

Explicit flags win over the file, which wins over the built-in defaults. Entries must be relative and stay inside your home directory; anything else is rejected with a clear error. An `include` that hits a never-copied rule is reported under "Failed" rather than silently dropped.

## Use as a library

```ts
import { collect, restore } from "create-dotfiles";

const summary = await collect({ formats: ["folder", "zip"], includeEnv: false });
console.log(summary);

restore({ force: false });
```

`collect`, `resolveTargets` (the planning step behind `--dry-run`), `restore`, `runInteractive` (bring your own prompter), the option and summary types, and `DEFAULT_TARGETS` are all exported with declarations. Everything is bundled; the package has no runtime dependencies.

## Guarantees worth knowing

- **Nothing is written until the plan is final.** Interactive cancels and `--dry-run` leave your disk untouched.
- **Output never merges.** If `dotfiles-<timestamp>` already exists, the run stops with `Output already exists` instead of writing into it.
- **Copies stay inside the collection.** Every path is validated to be relative and confined to your home directory before anything is copied.
- **Failures are per file.** One unreadable file is reported and the rest proceeds; the summary lists every skip and failure.

## Development

```shell
mise install          # node, pnpm and lefthook, pinned in mise.toml
pnpm install          # also installs the git hooks
pnpm dev              # run src/cli.ts with tsx
```

| Script               | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `pnpm test`          | Vitest                                                                |
| `pnpm test:coverage` | Vitest with the coverage thresholds enforced                          |
| `pnpm lint`          | Biome check                                                           |
| `pnpm format`        | Biome check `--write`                                                 |
| `pnpm typecheck`     | `tsc --noEmit`                                                        |
| `pnpm build`         | tsdown → `dist/cli.cjs`, `dist/index.cjs`, `dist/index.d.cts`         |
| `mise run ci`        | The whole CI job locally, with `CI=true`                              |

Releases are automated: dependabot's minor and patch updates are merged and published as soon as CI is green, and releases run only from GitHub Actions with npm Trusted Publishing. See [AGENTS.md](AGENTS.md) for the details.

## License

MIT
