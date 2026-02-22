# AGENTS.md

## Project Overview

**create-dotfiles** is a CLI tool that syncs dotfiles between the home directory and a backup folder (`~/.dotfiles`). Users define which files to sync in `~/.dotfilesrc`.

## Tech Stack

- **Runtime**: Node.js 24.x
- **Package Manager**: pnpm
- **Language**: TypeScript (strict mode, target ES2022, CommonJS output)
- **Bundler**: tsdown (config: `tsdown.config.mts`)
- **Linter/Formatter**: Biome (double quotes, semicolons, 2-space indent, 100 line width)
- **Test**: Vitest (node environment, tests in `src/**/*.test.ts`)
- **Commit Convention**: Conventional Commits via commitlint
- **Release**: semantic-release (changelog, npm publish, git tag, GitHub release)
- **CI/CD**: GitHub Actions (CI on PR, Release on push to main)

## Project Structure

```
src/
  index.ts          # Single entry point - CLI with backup/restore commands
dist/               # Build output (index.cjs, index.d.cts)
.github/
  workflows/
    ci.yml          # PR checks: lint, build, test
    release.yml     # Release on main push: build, test, semantic-release
  dependabot.yml    # Weekly updates for npm and github-actions
```

## Key Commands

```bash
pnpm build          # Build with tsdown
pnpm test           # Run tests with vitest
pnpm lint           # Lint with biome
pnpm format         # Format with biome
pnpm dev            # Run source directly with tsx
```

## Code Conventions

- Use `node:` prefix for Node.js built-in imports (e.g., `node:fs`, `node:path`)
- Double quotes, semicolons, trailing commas (ES5 style)
- 2-space indentation, 100 character line width
- Conventional commit messages: `feat:`, `fix:`, `chore:`, etc.
- No external runtime dependencies - only Node.js built-ins

## Architecture Notes

- Single-file CLI (`src/index.ts`) with no external dependencies
- Config file: `~/.dotfilesrc` (one dotfile path per line, `#` for comments)
- Backup directory: `~/.dotfiles`
- Two commands: `backup` (default) and `restore`
- Published as a CommonJS package with a `bin` entry pointing to `dist/index.cjs`

## Testing

- Test files colocate with source: `src/**/*.test.ts`
- Vitest with globals enabled
- Coverage via v8 provider
