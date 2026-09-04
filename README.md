<h1 align="center">create-dotfiles</h1>

<p align="center">
  <strong>One command. Every dotfile you care about, collected into a timestamped folder, zip or tar.gz.</strong><br />
  Your <code>.env</code> files come along; your private keys never do. No config file required.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/v/create-dotfiles?logo=npm&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/dm/create-dotfiles?logo=npm" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/create-dotfiles"><img src="https://img.shields.io/npm/types/create-dotfiles?logo=typescript&logoColor=white" alt="TypeScript types" /></a>
  <a href="https://github.com/thilllon/create-dotfiles/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/thilllon/create-dotfiles/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/thilllon/create-dotfiles" alt="License" /></a>
</p>

## Quickstart

Nothing to install and no config file to write. In a terminal it walks you through what it found;
with `--auto` it just runs.

```shell
npx create-dotfiles           # interactive
npx create-dotfiles --auto    # no prompts, defaults
```

Not sure what it would take from your home directory? Ask first. This writes nothing:

```console
$ npx create-dotfiles --auto --dry-run
Would copy 8 files (225 B) from /Users/you
  .zshrc (37 B) [core]
  .gitconfig (46 B) [core]
  .config/nvim/init.lua (10 B) [core]
  .config/nvim/lua/plugins.lua (11 B) [core]
  .tmux.conf (16 B) [core]
  .ssh/config (27 B) [core]
  .npmrc (40 B) [secrets]
  work/api/.env (38 B) [secrets]
Per group: core 6, custom 0, secrets 2, config-all 0
Not found (59): .zshenv, .zprofile, .bashrc, ...
Would write:
  folder: /Users/you/dotfiles-20260904-083845/
Dry run: nothing was written.
```

Drop `--dry-run` and that plan becomes `~/dotfiles-20260904-083845/`, every file at its path
relative to your home directory. `~/.config/nvim` was a symlink on this machine and came through as
real files, so the collection stands on its own. Add `--format folder,zip,tar` for archives of the
same tree beside it.

**Secrets come along by default.** `.env` files found by a bounded scan, plus `.npmrc`, `.yarnrc`,
`.netrc`, `.aws/credentials` and `.docker/config.json`. Pass `--no-include-env` to leave them out.
SSH and GPG private keys are never copied either way.

On the other machine, put it back:

```console
$ npx create-dotfiles restore
Restoring /Users/you/dotfiles-20260904-083845 into /Users/you
  [OK] .config/nvim/init.lua
  [OK] .config/nvim/lua/plugins.lua
  [OK] .gitconfig
  ...
Restored 8 files, 0 skipped, 0 failed.
```

`restore` takes the newest collection folder and never overwrites a file that is already there; run
it twice and the second run reports `[SKIP] .zshrc exists (use --force)`. Extract a zip or tar.gz
first, since restore reads a folder.

Next: [See it in action](#see-it-in-action) for the interactive flow, [Flags](#flags) for every
option, and [What gets collected](#what-gets-collected) for the full target list and the
never-copied rules.

## See it in action

Run it in a terminal and it walks you through what it found, what it will never touch, and what you want back:

1. Scans your home directory once and shows which known dotfiles exist on this machine, grouped (Shell, Git, Editors, Tools, …).
2. Lists what is **never copied**: `node_modules`, `.git`, caches, SSH/GPG private keys, files over 10 MB.
3. Asks whether to include **secret files** — `.env` files found by the scan (it tells you how many), plus `.npmrc`, `.netrc`, `.aws/credentials`, `.docker/config.json`. Default: yes.
4. Asks whether to include **everything under `~/.config`** (with a file count and size). Default: no.
5. Lets you pick output formats — `folder` (preselected), `zip`, `tar.gz` — any combination.
6. Shows the exact output paths and asks to proceed. Cancelling at any step writes nothing.

Scripted, it just does the sensible thing. This is a real run against a home directory with a
symlinked `~/.config/nvim`, a `.env` two levels deep, another `.env` inside `node_modules`, an SSH
key pair and a 20 MB file:

```console
$ npx create-dotfiles --auto --format folder,zip,tar
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
Not found (44): .zshenv, .zprofile, .bashrc, ...
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
| **▸ Zero setup**              | No config file needed. Built-in targets cover shells, Git, Vim/Neovim, tmux, terminal emulators, Starship, fish, mise, VS Code and Cursor, and more — with the right paths on macOS, Linux and Windows. |
| **▸ Interactive or scripted** | A terminal gets prompts; `--auto` gets defaults. Piped or in CI, it falls back to `--auto` on its own.                                                                                   |
| **▸ Timestamped, faithful**   | `~/dotfiles-YYYYMMDD-HHMMSS/` mirrors home-relative paths. Get a folder, a zip, a tar.gz, or all three in one run.                                                                       |
| **▸ Secrets in, keys out**    | `.env` files (found by a bounded scan), `.npmrc`, `.netrc`, `.aws/credentials`, `.docker/config.json` are included by default; `--no-include-env` leaves them out. SSH and GPG private keys are never copied, ever. |
| **▸ Never copies junk**       | `node_modules`, `.git`, caches, previous collections and files over 10 MB are skipped — and the skips are reported, not hidden.                                                          |
| **▸ Symlinks resolved**       | A stow-style symlinked `~/.config/nvim` is copied as real files, at every level, so nothing in the archive points back at a machine you no longer have.                                 |
| **▸ Safe restore**            | `restore` puts the newest collection back without overwriting anything unless you pass `--force`.                                                                                       |
| **▸ Dry run**                 | `--dry-run` prints exactly what would be copied, with sizes and groups, and writes nothing.                                                                                              |
| **▸ Typed library**           | `import { collect, restore } from "create-dotfiles"` ships with full TypeScript declarations and zero runtime dependencies.                                                             |

## Usage

```shell
npx create-dotfiles                 # interactive
npx create-dotfiles --auto          # defaults: core targets + secrets, folder output
npx create-dotfiles --dry-run       # show the plan, write nothing
npx create-dotfiles restore         # put the newest collection back (never overwrites)
```

Or install it: `npm i -g create-dotfiles` (also `pnpm add -g` / `yarn global add`). Node 22 or newer.

### Flags

Every flag works with `--auto` and, in interactive mode, pre-fills the corresponding question.

| Flag                     | Default   | Effect                                                                                     |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------ |
| `--auto`                 | off       | Run without prompts.                                                                       |
| `--include-env`          | on        | Include the secrets group (`.env` files and the credential files listed above). `--no-include-env` turns it off. |
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

The built-in list is the common set plus the set for the OS you run on; targets from the other
platforms are never attempted, so they do not show up under "Not found". Every path is relative
to your home directory (`%USERPROFILE%` on Windows) and written with `/` in the summary and the
archives on every OS. Only the entries that exist on your machine are copied.

**Common (every OS)**

- Shell: `.zshrc` `.zshenv` `.zprofile` `.bashrc` `.bash_profile` `.profile` `.inputrc`
- Git: `.gitconfig` `.gitignore_global` `.gitattributes_global`
- Editors: `.vimrc` `.ideavimrc` `.config/nvim` `.editorconfig`
- Terminal: `.tmux.conf` `.config/tmux` `.config/starship.toml` `.config/alacritty` `.config/kitty` `.config/wezterm` `.wezterm.lua` `.config/ghostty` `.config/fish` `.config/zellij`
- Tools: `.config/mise` `.tool-versions` `.config/gh/config.yml` `.config/htop` `.config/bat` `.config/lazygit`
- Non-secret parts of secret-adjacent tools: `.ssh/config` `.gnupg/gpg.conf` `.gnupg/gpg-agent.conf` `.aws/config`

**macOS**

- VS Code and Cursor: `Library/Application Support/{Code,Cursor}/User/{settings.json,keybindings.json,snippets}`
- `.hammerspoon` `.config/karabiner` `.skhdrc` `.yabairc` `.Brewfile` `Brewfile`

**Linux**

- VS Code, Code - OSS, VSCodium and Cursor: `.config/{Code,Code - OSS,VSCodium,Cursor}/User/{settings.json,keybindings.json,snippets}`
- `.bash_logout` `.xinitrc` `.xprofile` `.Xresources` `.config/i3` `.config/sway` `.config/hypr` `.config/waybar` `.config/rofi` `.config/dunst` `.config/picom` `.config/polybar` `.config/gtk-3.0/settings.ini` `.config/fontconfig`

**Windows** (relative to `%USERPROFILE%`)

- VS Code and Cursor: `AppData/Roaming/{Code,Cursor}/User/{settings.json,keybindings.json,snippets}`
- Neovim: `AppData/Local/nvim` (in addition to `.config/nvim`)
- Windows Terminal: `AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`
- PowerShell: `Documents/PowerShell/Microsoft.PowerShell_profile.ps1` `Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1`
- `AppData/Roaming/alacritty` `.wslconfig`

**Secrets (on by default; `--no-include-env` to skip)** — `.npmrc` `.yarnrc` `.netrc` `.aws/credentials` `.docker/config.json`, and every `.env` / `.env.*` found by a scan of your home directory that goes at most four levels deep, never enters the never-copied directories, does not follow symlinked directories (or junctions), and skips the top-level user folders: `Library`, `Desktop`, `Documents`, `Downloads`, `Movies`, `Music`, `Pictures`, `Public` (macOS, so it never asks for folder access), `Videos`, `Templates`, `snap` (Linux) and `AppData`, `Application Data`, `Local Settings`, `OneDrive`, `Contacts`, `Favorites`, `Links`, `Saved Games`, `Searches`, `3D Objects` (Windows). Core targets inside those folders, such as VS Code settings under `~/Library` or `AppData`, are unaffected. An entry the scan cannot read (a locked file, a junction that refuses access) is reported under "Failed" and skipped; the run continues.

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
include_env = true
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

Explicit flags win over the file, which wins over the built-in defaults. Entries must be relative and stay inside your home directory; anything else is rejected with a clear error. On Windows you can write them with backslashes (`AppData\Roaming\Code`); they are normalised to `/`. An `include` that hits a never-copied rule is reported under "Failed" rather than silently dropped.

## Use as a library

```ts
import { collect, restore } from "create-dotfiles";

const summary = await collect({ formats: ["folder", "zip"], includeEnv: false });
console.log(summary);

restore({ force: false });
```

`collect`, `resolveTargets` (the planning step behind `--dry-run`), `restore`, `runInteractive` (bring your own prompter), the option and summary types, `DEFAULT_TARGETS` (this OS) and `targetsFor(platform)` are all exported with declarations. Pass `platform: "win32"` (or `"darwin"`, `"linux"`) in the options to plan for another OS. Everything is bundled; the package has no runtime dependencies.

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
