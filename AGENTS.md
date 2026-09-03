# AGENTS.md

## Project Overview

**create-dotfiles** collects the dotfiles that matter from the home directory into a timestamped
folder — `~/dotfiles-YYYYMMDD-HHMMSS/` — and optionally a zip and/or tar.gz of it, preserving
home-relative paths. In a terminal it runs an interactive flow (`@clack/prompts`); with `--auto`,
when piped, or in CI it runs with defaults. Secrets (`.env` files found by a bounded scan, `.npmrc`,
`.netrc`, `.aws/credentials`, `.docker/config.json`) are included by default and can be left out with
`--no-include-env`; SSH and GPG private keys are never
copied. `restore` copies a collection back without overwriting unless `--force`. The same code is
published as a typed library (`dist/index.cjs` + `dist/index.d.cts`).

## Tech Stack

- **Runtime**: Node.js 24 (pinned exactly in `mise.toml`; CI also runs 22 and 26 on Ubuntu, and 24 on Windows and macOS)
- **Toolchain manager**: mise — `mise.toml` pins node, pnpm and lefthook; `mise run <task>` mirrors the pnpm scripts and `mise run ci` runs the whole CI job locally
- **Package Manager**: pnpm 11 (`pnpm-workspace.yaml` approves the build scripts pnpm 11 would otherwise reject)
- **Language**: TypeScript 6 (strict, target ES2022, `module: preserve`, `moduleResolution: bundler`, `types: ["node"]`)
- **Bundler**: tsdown 0.22 (config: `tsdown.config.mts`, two entries); everything is bundled, so the published package has no runtime dependencies
- **CLI parsing**: cac 7. **Prompts**: `@clack/prompts` (ESM-only; bundled). **Archives**: `tar`, `yazl`
- **Linter/Formatter**: Biome 2.5 (double quotes, semicolons, 2-space indent, 100 line width)
- **Test**: Vitest 4 + `@vitest/coverage-v8` (the two must stay on identical versions); `fflate` is used only in tests to read zips
- **Git hooks**: lefthook, installed by the `prepare` script on `pnpm install`
- **Release**: release-it 21 from `.github/workflows/release.yml`, publishing with npm Trusted Publishing (OIDC)
- **CI/CD**: GitHub Actions — see "CI and releases"

## Project Structure

```
src/
  cli.ts               # cac wiring only; a thin layer over the library
  index.ts             # public API; package.json main/types/exports point at its build
  collect.ts           # collect(): stage files, write folder/zip/tar, build the summary
  plan.ts              # resolveTargets(), filterPlan(), scanEnvFiles(), collectionName()
  targets.ts           # default targets (common + darwin/linux/win32), hard-exclude and private-key rules
  paths.ts             # POSIX <-> native path helpers; archive entry names
  walk.ts              # filesystem walking: follows symlinks at every level, detects loops
  interactive.ts       # runInteractive(prompter): the prompt flow behind a Prompter interface
  clack-prompter.ts    # Prompter implemented on @clack/prompts
  options.ts           # PlanOptions -> ResolvedOptions (flags > config file > defaults)
  config.ts            # ~/.dotfilesrc.toml loading and validation (the file is never created)
  formats.ts           # folder | zip | tar parsing
  report.ts            # summary, "found on this machine" and "never copied" formatting
  restore.ts           # restore(), findLatestCollection()
  errors.ts            # DotfileError
  test-helpers.ts      # shared fixtures for tests
  *.test.ts            # colocated tests; cli.test.ts spawns the CLI with HOME/USERPROFILE in a temp dir
dist/                  # cli.cjs (bin), index.cjs, index.d.cts
.github/
  workflows/
    ci.yml                        # push/PR: lint, typecheck, test with coverage, build (ubuntu x Node 22/24/26, windows + macos on 24)
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
- Expected failures throw `DotfileError`; the CLI prints the message and exits 1, never a stack trace

## Git Conventions

- Do NOT add `Co-Authored-By` lines to commit messages. A `Claude-Session:` trailer is fine.
- `main` is protected (pull requests required). The maintainer pushes directly as an admin;
  GITHUB_TOKEN cannot, which is why the release workflow pushes its version commit with the
  maintainer's `RELEASE_TOKEN` (see below)
- lefthook runs `pnpm format` on pre-commit and lint/typecheck/test/build on pre-push. CI and the
  release job set `LEFTHOOK=0`

## CI and releases

- **CI** (`ci.yml`) runs on every push to `main` and every pull request: `pnpm lint`,
  `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, on Ubuntu with Node 22, 24 and 26 and on
  Windows and macOS with Node 24 (`fail-fast: false`, steps under `shell: bash`). `mise run ci` runs the
  same sequence locally with `CI=true`; that flag matters because some tools (tsdown, for one) treat
  warnings as errors only in CI.
- **Releases** are made only by `release.yml` (workflow_dispatch). npm Trusted Publishing is
  registered for that workflow file, so publishing from anywhere else is rejected. There is no
  NPM_TOKEN. release-it runs with `npm.skipChecks` because its `npm whoami` pre-flight cannot work
  under OIDC.
- **The version on `main` matches npm after every release.** The workflow reads the latest
  version from npm, adds one patch (or takes the `version` input for a minor/major bump), and
  runs `release-it --ci <version>`, which rewrites `package.json`, builds, publishes, commits
  `chore(release): v<version>`, tags it and pushes both. npm is used as the reference only so a
  stale `package.json` can never cause a publish of a version that already exists.
- **`RELEASE_TOKEN` is required.** GITHUB_TOKEN cannot push to the protected `main` (GH006), so
  the release checkout uses `RELEASE_TOKEN`, a fine-grained personal access token of a repository
  admin scoped to this repository with Contents: Read and write. The workflow fails before doing
  anything if the secret is missing, so it can never publish to npm without also committing. The
  push made with that token runs CI on `main`; it cannot start another release, because
  `release.yml` only runs on `workflow_dispatch`.
- **Dependabot**: minor and patch updates arrive weekly as one grouped PR per ecosystem.
  `dependabot-auto-release.yml` merges such a PR once CI is green and dispatches a release, so the
  package gets a new patch version with no human involved. Major bumps stay open for review.
- `release.yml` declares `concurrency: release`, so two dispatches queue instead of racing for the
  same version.

## Architecture Notes

- **Plan, then write.** `resolveTargets()` produces a `Plan` (files with group and size, missing
  targets, too-large files, output paths) without touching the disk; `writePlan()` executes it.
  `--dry-run` is the plan alone. The interactive flow scans once with every group enabled and
  narrows with `filterPlan()` per answer; tests assert this equals a fresh plan for all opt-in
  combinations.
- **Groups**: `core` (built-in targets), `custom` (config `include`), `secrets`, `config-all`. A
  `.env` file belongs to `secrets` wherever it sits, even inside a core target or `~/.config`, so
  secrets are left out only with `--no-include-env` or `include_env = false`.
- **Never copied, regardless of options**: hard-excluded directory names anywhere in a path
  (`node_modules`, `.git`, caches, …), `Library/Caches`, `Library/Application Support/*/Cache*`,
  private keys (`.ssh/*` except `config` and `*.pub`; `.gnupg/private-keys-v1.d`, `*.gpg`, `*.kbx`),
  previous collections (`dotfiles-YYYYMMDD-HHMMSS` with or without `.zip`/`.tar.gz`), and files over
  the size cap. Rules live in `targets.ts`.
- **`.env` scan** is bounded: depth 4 from the home directory, never entering hard-excluded
  directories, never following symlinked directories (or Windows junctions and other reparse
  points), and skipping the top-level user folders (`ENV_SCAN_SKIPPED_FOLDERS`: the macOS ones —
  Library, Desktop, Documents, Downloads, Movies, Music, Pictures, Public — so it never triggers
  TCC "would like to access" prompts, plus Videos, Templates, snap for Linux and AppData,
  Application Data, Local Settings, OneDrive, Contacts, Favorites, Links, Saved Games, Searches,
  3D Objects for Windows; one flat list on every OS). Core targets under `~/Library` or `AppData`
  and `--include-config` are unaffected by that skip. EPERM/EBUSY on `readdir`/`stat` are reported
  as failures and skipped; the scan never throws (`plan.errors.test.ts` simulates them).
- **Symlinks are followed at every level** when copying (`walk.ts`), with loop detection, so a
  stow-style setup is captured as real files and the archive is self-contained.
- **Outputs**: files are always staged into the timestamped folder; zip and tar.gz are written from
  the staging folder; when `folder` is not among the requested formats the staging folder is removed
  afterwards (also on failure). An existing output path is an error, never merged into.
- **Failures are per file**: one unreadable file is reported in the summary and the run continues.
- **Config file** `~/.dotfilesrc.toml` is optional and never created. `[files] include`/`exclude`
  and `[settings]` (`include_env`, `include_config`, `formats`, `max_file_size_mb`, `out`) are
  validated: entries must be non-empty strings, relative, and confined to the home directory, and
  are then normalized (`./x`, `a/../b`, trailing slashes) so the spelling never reaches archive
  entry names — yazl rejects `..` segments. Error messages still quote what the user wrote. A
  legacy `[files] list` key is treated as `include`. Precedence: flags > config file > defaults.
- **Nothing reads the home directory on `--help`/`--version`**; everything is constructed inside
  command actions, never at module scope (this was a real bug once).
- **Non-TTY** (piped, CI): prints one notice and runs as `--auto`.
- **Restore** defaults to the newest `dotfiles-*` directory by name, refuses archives and the home
  directory itself as a source, skips existing files unless `--force`.
- **Packaging**: CommonJS. `bin` → `dist/cli.cjs`; `main`/`types`/`exports` → `dist/index.cjs` and
  `dist/index.d.cts` (declarations without a source map, since `src/` is not published).
  `@clack/prompts` is ESM-only; it bundles fine, and the tsx-based subprocess tests rely on
  `require(esm)`, which needs Node ≥ 22.12.

## Config File Example

```toml
# ~/.dotfilesrc.toml — optional, never created automatically

[settings]
include_env = true
include_config = false
formats = ["folder", "zip"]
max_file_size_mb = 10
out = "~/Backups"

[files]
include = [".config/foo", "work/scripts"]   # extra paths, relative to the home directory
exclude = [".config/kitty", "Snapshots"]    # paths or directory names to exclude
```

## Platforms

- **Default targets are per platform.** `targetsFor(platform)` = common categories + one of
  `PLATFORM_TARGET_CATEGORIES` (`darwin`, `linux`, `win32`; anything else counts as `linux`) +
  secrets. `PlanOptions.platform` (default `process.platform`) selects the set and is recorded on
  the `Plan`, so a test on Linux can exercise all three lists. `DEFAULT_TARGETS` is this OS's list.
  Add new targets to the right table in `targets.ts`, with `/` separators, relative to home
  (`%USERPROFILE%` on Windows).
- **Home-relative paths are POSIX everywhere inside the package**: target lists, `PlannedFile.path`,
  summaries, restore listings and archive entry names all use `/`. Conversion to native happens
  only at the filesystem boundary via `path.join(homeDir, posixPath)` (accepts `/` on Windows);
  anything coming back native (`path.relative`, recursive `readdir`) goes through
  `toPosixPath()` from `paths.ts`. Zip entries are built with `archiveEntryName()` — yazl throws on
  a backslash — and tar writes `/` names itself, so both mirror the staged folder. Config
  `include`/`exclude` entries are normalised `\` → `/` before validation (errors still quote the
  user's spelling); `expandHome` accepts `~/` and `~\`; exclusion matching splits on either
  separator; `rmSync` of staged output passes `maxRetries` for Windows file locks; restore compares
  the source with the home directory case-insensitively on win32.
- **Test policies.** `cli.test.ts` spawns `process.execPath` with tsx's JS entry (never the
  `.bin` shim, a `.cmd` on Windows) and sets both `HOME` and `USERPROFILE`. File symlinks need a
  privilege on Windows: such tests use `it.skipIf(!canSymlink())`; directory links go through
  `symlinkDir()` (a junction on win32) and run everywhere. The socket test is skipped on win32.
  Error-code assertions accept the platform variants (`EISDIR|EPERM|EACCES`). Fixture names must
  not differ only by case (macOS and Windows file systems are case-insensitive). Helpers that
  take a separator are unit-tested with `path.win32` on Linux.

## Testing

- Test files colocate with source: `src/**/*.test.ts`
- Vitest, node environment, explicit imports (globals are NOT enabled)
- Coverage via the v8 provider (`@vitest/coverage-v8`), enforced by thresholds in
  `vitest.config.ts` (statements 95, branches 90, functions 95, lines 95); `pnpm test:coverage`
  fails the build if coverage regresses. The only uncovered lines are permission-error branches
  that cannot be provoked when tests run as root
- `src/cli.ts` is excluded from coverage thresholds on purpose: `cli.test.ts` exercises it by
  spawning a real subprocess (the only way to catch module-load side effects), and v8 cannot
  instrument across a process boundary. Keep `cli.ts` thin so that exclusion stays honest
- The interactive flow is tested through a fake `Prompter`; `clack-prompter.ts` is tested with
  `@clack/prompts` mocked. No test drives a real TTY
- Zip contents are verified by reading the central directory with `fflate`; tar contents with
  `tar.list`
- CLI tests point `HOME` and `USERPROFILE` at a temp directory; never let a test touch the real
  home directory
