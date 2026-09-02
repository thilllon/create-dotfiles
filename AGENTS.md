# AGENTS.md

## Project Overview

**create-dotfiles** is a CLI tool that syncs dotfiles between the home directory and a backup folder (`~/.dotfiles`). Users define which files to sync in `~/.dotfilesrc.toml`. If the config file is missing, it is auto-created with a default config. Backup produces a `.tar.gz` archive.

## Tech Stack

- **Runtime**: Node.js 24 (pinned exactly in `mise.toml`; CI also runs 22 and 26)
- **Toolchain manager**: mise — `mise.toml` pins node, pnpm and lefthook; `mise run <task>` mirrors the pnpm scripts and `mise run ci` runs the whole CI job locally
- **Package Manager**: pnpm 11 (`pnpm-workspace.yaml` approves the build scripts pnpm 11 would otherwise reject)
- **Language**: TypeScript 6 (strict, target ES2022, `module: preserve`, `moduleResolution: bundler`, `types: ["node"]`)
- **Bundler**: tsdown 0.22 (config: `tsdown.config.mts`); everything is bundled, so the published package has no runtime dependencies
- **CLI parsing**: cac 7
- **Linter/Formatter**: Biome 2.5 (double quotes, semicolons, 2-space indent, 100 line width)
- **Test**: Vitest 4 + `@vitest/coverage-v8` (the two must stay on identical versions)
- **Git hooks**: lefthook, installed by the `prepare` script on `pnpm install`
- **Release**: release-it 21 from `.github/workflows/release.yml`, publishing with npm Trusted Publishing (OIDC)
- **CI/CD**: GitHub Actions — see "CI and releases"

## Project Structure

```
src/
  cli.ts                # CLI entry point (cac-based, backup/restore commands)
  cli.test.ts           # End-to-end tests: spawns the CLI as a subprocess
  dotfile-manager.ts    # Core logic: config parsing, backup, restore, archive
  dotfile-manager.test.ts
dist/                   # Build output (cli.cjs)
.github/
  workflows/
    ci.yml                        # push/PR: lint, typecheck, test with coverage, build (Node 22/24/26)
    release.yml                   # workflow_dispatch: publish to npm, push the version tag
    dependabot-auto-release.yml   # after CI on a dependabot PR: merge minor/patch, dispatch release.yml
  dependabot.yml                  # weekly, grouped minor+patch, for npm and github-actions
mise.toml               # tool pins + tasks
lefthook.yml            # pre-commit: format; pre-push: lint, typecheck, test, build
```

## Key Commands

```bash
pnpm build          # Build with tsdown
pnpm test           # Run tests with vitest
pnpm test:coverage  # Run tests with coverage thresholds enforced
pnpm lint           # Lint with biome
pnpm format         # Format with biome
pnpm typecheck      # tsc --noEmit
pnpm dev            # Run source directly with tsx
mise run ci         # The full CI job locally, with CI=true (tools escalate warnings in CI)
```

Do not run `pnpm release` locally: releases happen only in CI (see below).

## Code Conventions

- Use `node:` prefix for Node.js built-in imports (e.g., `node:fs`, `node:path`)
- Double quotes, semicolons, trailing commas (ES5 style)
- 2-space indentation, 100 character line width
- No external runtime dependencies beyond what's bundled by tsdown

## Git Conventions

- Do NOT add `Co-Authored-By` lines to commit messages
- `main` is protected (pull requests required). The maintainer pushes directly as an admin; GitHub
  Actions cannot, which is why releases never push a commit (see below)
- lefthook runs `pnpm format` on pre-commit and lint/typecheck/test/build on pre-push. CI and the
  release job set `LEFTHOOK=0`

## CI and releases

- **CI** (`ci.yml`) runs on every push to `main` and every pull request: `pnpm lint`,
  `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, on Node 22, 24 and 26. `mise run ci` runs the
  same sequence locally with `CI=true`; that flag matters because some tools (tsdown, for one) treat
  warnings as errors only in CI.
- **Releases** are made only by `release.yml` (workflow_dispatch). npm Trusted Publishing is
  registered for that workflow file, so publishing from anywhere else is rejected. There is no
  NPM_TOKEN. release-it runs with `npm.skipChecks` because its `npm whoami` pre-flight cannot work
  under OIDC.
- **npm is the source of truth for the version.** GITHUB_TOKEN cannot push to the protected `main`,
  so the version bump is never committed. The workflow reads the latest version from npm, adds one
  patch (or takes the `version` input for a minor/major bump), and runs `release-it --ci <version>`,
  which rewrites `package.json`, builds, publishes, tags `v<version>` and pushes only the tag. The
  `version` field on `main` is informational and lags npm.
- **Dependabot**: minor and patch updates arrive weekly as one grouped PR per ecosystem.
  `dependabot-auto-release.yml` merges such a PR once CI is green and dispatches a release, so the
  package gets a new patch version with no human involved. Major bumps stay open for review.
- `release.yml` declares `concurrency: release`, so two dispatches queue instead of racing for the
  same version.

## Architecture Notes

- CLI entry: `src/cli.ts` (uses cac for argument parsing)
- Core: `src/dotfile-manager.ts` (DotfileManager class)
- Config file: `~/.dotfilesrc.toml` (TOML format, parsed with smol-toml)
- If config is missing, a default config is auto-created with `DEFAULT_CONFIG` constant
- Backup directory: `~/.dotfiles` (configurable via `settings.backup_dir`)
- Backup produces `~/.dotfiles-backup.tar.gz` archive (using tar package)
- Two commands: `backup` (default) and `restore` (`restore --force` overwrites existing files)
- `DotfileManager` is constructed lazily inside each command action, never at module scope,
  so `--help` and `--version` do not read or create the config file
- Expected failures throw `DotfileError`; the CLI prints the message and exits 1 (no stack trace)
- Config values are validated after parsing: `files.list` must be an array of non-empty
  strings, and no entry (nor `settings.backup_dir`) may be absolute or escape the home directory
- Symlinks are dereferenced at every level when copying, so the archive is self-contained
- Published as a CommonJS package with a `bin` entry pointing to `dist/cli.cjs`

## Default Config Example

```toml
# ~/.dotfilesrc.toml

[settings]
backup_dir = ".dotfiles"

[files]
list = [
  # Shell
  ".zshrc",
  ".bashrc",
  ".bash_profile",

  # Git
  ".gitconfig",
  ".gitignore_global",

  # Editor - Vim/Neovim
  ".vimrc",
  ".config/nvim",

  # Editor - VS Code
  "Library/Application Support/Code/User/settings.json",
  "Library/Application Support/Code/User/keybindings.json",
  "Library/Application Support/Code/User/snippets",

  # Editor - Cursor
  "Library/Application Support/Cursor/User/settings.json",
  "Library/Application Support/Cursor/User/keybindings.json",
  "Library/Application Support/Cursor/User/snippets",

  # Tools
  ".tmux.conf",
  ".config/starship.toml",

  # Node
  ".npmrc",
]
```

## Testing

- Test files colocate with source: `src/**/*.test.ts`
- Vitest, node environment, explicit imports (globals are NOT enabled)
- Coverage via the v8 provider (`@vitest/coverage-v8`), enforced by thresholds in
  `vitest.config.ts`; `pnpm test:coverage` fails the build if coverage regresses
- `src/cli.ts` is excluded from coverage thresholds on purpose: `cli.test.ts` exercises it
  by spawning a real subprocess (the only way to catch module-load side effects), and v8
  cannot instrument across a process boundary
- CLI tests point `$HOME` at a temp directory; never let a test touch the real home directory
