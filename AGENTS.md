# AGENTS.md

## Project Overview

**create-dotfiles** collects the dotfiles that matter from the home directory into a timestamped
folder — `~/dotfiles-YYYYMMDD-HHMMSS/` — and optionally a zip and/or tar.gz of it, preserving
home-relative paths. In a terminal it runs an interactive flow (`@clack/prompts`); with `--auto`,
when piped, or in CI it runs with defaults. Secrets (`.env` files found by a bounded scan, `.npmrc`,
`.netrc`, `.aws/credentials`, `.docker/config.json`) are included by default and can be left out with
`--no-include-env`; SSH and GPG private keys are never
copied. `restore` copies a collection back without overwriting unless `--force`. The same code is
published as a typed library (`dist/index.cjs` + `dist/index.d.cts`). It is distributed on npm and,
following npm automatically, through the Homebrew tap `thilllon/tap` (see "CI and releases").

## Tech Stack

- **Runtime**: Node.js 24 (pinned exactly in `mise.toml`; CI also runs 22 and 26 on Ubuntu, and 24 on Windows and macOS)
- **Toolchain manager**: mise — `mise.toml` pins node, pnpm, lefthook and gitleaks; `mise run <task>` mirrors the pnpm scripts and `mise run ci` runs the whole CI job locally
- **Package Manager**: pnpm 11 (`pnpm-workspace.yaml` approves the build scripts pnpm 11 would otherwise reject)
- **Language**: TypeScript 7 (strict, target ES2022, `module: preserve`, `moduleResolution: bundler`, `types: ["node"]`)
- **Bundler**: tsdown 0.23 (config: `tsdown.config.mts`, two entries); everything is bundled, so the published package has no runtime dependencies
- **CLI parsing**: cac 7. **Prompts**: `@clack/prompts` (ESM-only; bundled). **Archives**: `tar`, `yazl`, and `@zip.js/zip.js` for AES-256 zips only (pinned exactly; imported lazily from `lib/zip-core-custom.js`, so it is a separate chunk in `dist/` that plain runs never load)
- **Linter**: oxlint 1 (`.oxlintrc.json`: `correctness` as errors; `pnpm lint` passes `--deny-warnings`)
- **Formatter**: oxfmt 0.74 (`.oxfmtrc.json`: double quotes, semicolons, 2-space indent, 100 line
  width, ES5 trailing commas, sorted imports without blank lines between groups, sorted `package.json`).
  Both configs point `$schema` at `node_modules`, so the schema always matches the installed version
- **Test**: Vitest 4 + `@vitest/coverage-v8` (the two must stay on identical versions); `fflate` is used only in tests to read zips
- **Git hooks**: lefthook, installed by the `prepare` script on `pnpm install`
- **Secret scanning**: gitleaks 8 (pinned in `mise.toml`) on staged changes in pre-commit and on the
  checked-out tree in CI
- **Release**: Changesets 3 (`.changeset/`) from `.github/workflows/release.yml` on every push to `main`, publishing with npm Trusted Publishing (OIDC)
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
  zip-password.ts      # zip password policy, generator, and the CREATE_DOTFILES_ZIP_PASSWORD(_FILE) readers
  test-helpers.ts      # shared fixtures for tests
  test-aes-zip.ts      # test-only WinZip AES reader on node:crypto, independent of zip.js
  *.test.ts            # colocated tests; cli.test.ts spawns the CLI with HOME/USERPROFILE in a temp dir
dist/                  # cli.cjs (bin), index.cjs, index.d.cts, and zip-core-custom-*.cjs chunks (zip.js, loaded only to encrypt)
.github/
  workflows/
    ci.yml                        # push/PR: lint, typecheck, test with coverage, build (ubuntu x Node 22/24/26, windows + macos on 24)
    release.yml                   # push to main: version pending changesets, or publish and tag
    dependabot-auto-merge.yml     # after CI on a dependabot PR: merge grouped minor/patch with RELEASE_TOKEN
  dependabot.yml                  # weekly, grouped minor+patch, for npm and github-actions
mise.toml               # tool pins + tasks
lefthook.yml            # pre-commit: format, gitleaks; pre-push: lint, typecheck, test, build
.gitleaksignore         # fingerprints of non-secret findings already in history
```

## Key Commands

```bash
pnpm build          # Build with tsdown
pnpm test           # Run tests with vitest
pnpm test:coverage  # Run tests with coverage thresholds enforced
pnpm lint           # oxlint (warnings fail) + oxfmt --check
pnpm format         # Format with oxfmt
pnpm typecheck      # tsc --noEmit
pnpm dev            # Run source directly with tsx
mise run ci         # The full CI job locally, with CI=true (tools escalate warnings in CI)
```

Releases happen only in CI (see below): never run `changeset version` or `changeset publish` locally.

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
- lefthook runs `pnpm format` and `gitleaks git --pre-commit --staged` on pre-commit and
  lint/typecheck/test/build on pre-push. CI and the release job set `LEFTHOOK=0`
- A gitleaks false positive in the tree gets a `gitleaks:allow` comment on its line; one already in
  history goes into `.gitleaksignore` by fingerprint. Never allowlist a real secret: rotate it

## CI and releases

- **CI** (`ci.yml`) runs on every push to `main` and every pull request: `gitleaks dir` (before
  `pnpm install`, so only tracked files are scanned), `pnpm lint`,
  `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, on Ubuntu with Node 22, 24 and 26 and on
  Windows and macOS with Node 24 (`fail-fast: false`, steps under `shell: bash`). `mise run ci` runs the
  same sequence locally with `CI=true`; that flag matters because some tools (tsdown, for one) treat
  warnings as errors only in CI.
- **Versions come from Changesets.** A PR that changes what users get from npm (code, bundled
  dependencies, CLI output) adds a changeset (`pnpm changeset`) naming the bump and the line for
  `CHANGELOG.md`; the agent implementing the change writes it as part of the PR. A PR without one
  (docs, CI, tests, tooling) releases nothing. Commit messages never decide versions.
- **A merge to `main` releases.** `release.yml` runs on every push to `main` and decides from the
  pushed commit's history. The newest `chore(release): v<x>` commit is the release commit: if npm
  lacks `<x>` (a 404; any other npm error fails the run), it checks out that commit, runs
  lint/typecheck/test/build and `changeset publish` (provenance required), and pushes tag `v<x>`;
  if npm has `<x>` but the tag is missing, it tags that commit. Then, if the pushed commit is still
  the head of `main` and changesets are pending, it runs `changeset version` and `pnpm format` and
  pushes `chore(release): v<y>`, whose own run publishes it. Publishing never uses a later commit,
  so npm, the tag and `CHANGELOG.md` always describe the same tree, even when runs are cancelled
  or a merge lands mid-release. `workflow_dispatch` (on `main` only) reruns the same decision.
- **Publishing is only from `release.yml`.** npm Trusted Publishing is registered for that
  workflow file, so publishing from anywhere else is rejected. There is no NPM_TOKEN; the OIDC
  publication also signs the provenance the Homebrew tap checks. Never publish locally.
- **`RELEASE_TOKEN` is required.** GITHUB_TOKEN cannot push to the protected `main` (GH006), and
  its pushes and merges start no workflows. The release checkout and the Dependabot merge
  therefore use `RELEASE_TOKEN`, a fine-grained personal access token of a repository admin
  scoped to this repository with Contents: Read and write (enough for the REST merge too). The release job fails before doing anything if the secret is missing.
- **Dependabot**: minor and patch updates arrive weekly as one grouped PR per ecosystem.
  `dependabot-auto-merge.yml` merges the npm group with `RELEASE_TOKEN`, through the REST API and
  only at the head CI passed on, so the push starts `release.yml`. Dependabot cannot write
  changesets, so `release.yml` writes a patch changeset for every Dependabot commit since the last
  release commit that changes `package.json` or `pnpm-lock.yaml` (every dependency is bundled into
  `dist/`). The GitHub Actions group and major bumps stay open for review: an Actions update edits
  `.github/workflows/`, which needs a Workflows token permission, and releases nothing.
- `release.yml` declares `concurrency: release`: runs queue instead of racing for a version.
  GitHub cancels an older pending run when a newer one queues, which is safe because the decision
  is made from the commit, and a newer commit contains the older one.
- **Homebrew** (`brew tap thilllon/tap && brew trust thilllon/tap`, then
  `brew install create-dotfiles`): the formula lives in
  [thilllon/homebrew-tap](https://github.com/thilllon/homebrew-tap), and nothing in this repository
  pushes to it. The tap's `bump.yml` polls npm every three hours; for a newer version it verifies
  the tarball's npm provenance (signed by this repository's `release.yml` running on `main`),
  rewrites `url`/`sha256`, runs `brew style`, `brew audit --strict --online`,
  `brew install --build-from-source` and `brew test` on macOS and Linux, and only then commits.
  A release therefore needs no Homebrew step here. GitHub disables scheduled workflows in a public
  repository after 60 days without activity. Bump commits are activity, so this happens only after
  a long release drought (past gaps between releases were 192 and 489 days). If it happens,
  `release.yml`'s `homebrew` job fails and opens an issue here that mentions the owner, with the
  fix: `gh workflow enable bump.yml -R thilllon/homebrew-tap && gh workflow run bump.yml -R
  thilllon/homebrew-tap`. The issue is what reaches a human: a failed run alone may notify nobody.
  The tap uses no keepalive trick, because GitHub has disabled a keepalive action for bypassing
  that policy.
- The tap's provenance check pins the publisher. Renaming `release.yml` requires updating
  `SOURCE_WORKFLOW` in the tap's `bump.yml`. Publishing from a branch other than `main` requires
  updating its `SOURCE_REF`. The formula's `test do` block runs the built CLI, so a change that
  breaks `--version`, `--auto --format folder,zip` or `restore` blocks the Homebrew update until
  the formula's test is adjusted in a tap PR.

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
- **Outputs**: files are staged into the timestamped folder; zip and tar.gz are written from the
  staged copies; when `folder` is not among the requested formats the staging folder is removed
  afterwards (also on failure). An encrypted zip without `folder` is staged in a private `mkdtemp`
  directory (0700) under the OS temp dir instead, so no plaintext copy ever reaches the output
  directory; `CollectProgress.stagingDir` names the directory actually used. An existing output
  path is an error, never merged into. A failed archive's stream is torn down by
  `discardOutput`: it waits for 'close' (a pending open would otherwise re-create the file) and
  ignores the follow-on ERR_STREAM_DESTROYED, so the partial file is removed and the original
  error is reported.
- **Failures are per file**: one unreadable file is reported in the summary and the run continues.
- **Encrypted zip** (`--encrypt-zip`, `encrypt_zip`, library `encryptZip` + `zipPassword`):
  - Format: WinZip AES-256, AE-2 (method 99, extra field 0x9901, CRC stored as 0), written by zip.js;
    unencrypted zips stay on yazl. Entries are added one at a time from `createReadStream` with an
    explicit size: concurrent adds buffer in memory, and `fs.openAsBlob` misreports sizes over 4 GiB.
  - The password is settled in `writePlan` before anything is written. It is validated by
    `zipPasswordProblem`: 15-99 printable ASCII characters. 15 is the NIST single-factor floor;
    ASCII-only and 99 are 7-Zip's limits.
  - A string `zipPassword` for a plan that does not encrypt is an error, never a silently
    unprotected zip. A function source is called only when the zip is really encrypted, which is
    how the CLI reads the environment lazily.
  - `encryptZip: true` without zip among the formats is an error. The config's `encrypt_zip` is
    ignored when no zip is written.
  - Password sources: a terminal run always prompts, masked and twice; a mismatch goes back to the
    first entry. An empty entry generates a 150-bit Crockford-base32 password, used only after
    "Have you stored it?"; answering No goes back to the entry. clack's confirm submits on "y", so a
    following Enter lands on the password prompt as an empty entry. `--auto` and non-TTY read only
    `CREATE_DOTFILES_ZIP_PASSWORD` or `CREATE_DOTFILES_ZIP_PASSWORD_FILE` (setting both is an error;
    a UTF-8 BOM in the file is dropped). There is never an argv flag with the password, and never a
    password in the config. `--encrypt-zip` rejects any value: cac does not treat dashed flags as
    boolean, and `--encrypt-zip ""` would otherwise arrive as 0 and turn encryption off.
  - `Prompter.password` is optional, so a custom prompter written before it still compiles; choosing
    encryption with such a prompter and no `zipPassword` is a DotfileError.
  - The summary marks the zip "(AES-256, password-protected)". It warns that a folder or tar.gz
    from the same run is not encrypted.
- **Config file** `~/.dotfilesrc.toml` is optional and never created. `[files] include`/`exclude`
  and `[settings]` (`include_env`, `include_config`, `encrypt_zip`, `formats`, `max_file_size_mb`,
  `out`) are
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
encrypt_zip = false # AES-256 zip; the password is never read from this file
formats = ["folder", "zip"]
max_file_size_mb = 10
out = "~/Backups"

[files]
include = [".config/foo", "work/scripts"] # extra paths, relative to the home directory
exclude = [".config/kitty", "Snapshots"] # paths or directory names to exclude
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
  `tar.list`. Encrypted zips are decrypted by `test-aes-zip.ts`, written from the WinZip AE-x spec
  on node:crypto (PBKDF2, verifier, HMAC-SHA1-80, little-endian AES-CTR). It never trusts zip.js to
  check its own output. It also asserts AES-256, AE-2 and a zero CRC, so a zip.js update cannot
  silently weaken the format. Dependabot's minor/patch auto-merge bumps zip.js too; this test is
  what gates it
- CLI tests point `HOME` and `USERPROFILE` at a temp directory; never let a test touch the real
  home directory
