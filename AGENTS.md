# AGENTS.md

## Project Overview

**create-dotfiles** is a CLI tool that syncs dotfiles between the home directory and a backup folder (`~/.dotfiles`). Users define which files to sync in `~/.dotfilesrc.toml`. If the config file is missing, it is auto-created with a default config. Backup produces a `.tar.gz` archive.

## Tech Stack

- **Runtime**: Node.js 24.x
- **Package Manager**: pnpm
- **Language**: TypeScript (strict mode, target ES2022, CommonJS output)
- **Bundler**: tsdown (config: `tsdown.config.mts`)
- **Linter/Formatter**: Biome (double quotes, semicolons, 2-space indent, 100 line width)
- **Test**: Vitest (node environment, tests in `src/**/*.test.ts`)
- **Release**: release-it (workflow_dispatch trigger)
- **CI/CD**: GitHub Actions (CI on PR/push, Release on workflow_dispatch)

## Project Structure

```
src/
  cli.ts                # CLI entry point (cac-based, backup/restore commands)
  dotfile-manager.ts    # Core logic: config parsing, backup, restore, archive
  dotfile-manager.test.ts
dist/                   # Build output (cli.cjs)
.github/
  workflows/
    ci.yml              # PR/push checks: lint, typecheck, build
    release.yml         # Release on workflow_dispatch: build, test, release-it
  dependabot.yml        # Weekly updates for npm and github-actions
```

## Key Commands

```bash
pnpm build          # Build with tsdown
pnpm test           # Run tests with vitest
pnpm lint           # Lint with biome
pnpm format         # Format with biome
pnpm dev            # Run source directly with tsx
pnpm release        # Release with release-it (interactive)
```

## Code Conventions

- Use `node:` prefix for Node.js built-in imports (e.g., `node:fs`, `node:path`)
- Double quotes, semicolons, trailing commas (ES5 style)
- 2-space indentation, 100 character line width
- No external runtime dependencies beyond what's bundled by tsdown

## Git Conventions

- Do NOT add `Co-Authored-By` lines to commit messages

## Architecture Notes

- CLI entry: `src/cli.ts` (uses cac for argument parsing)
- Core: `src/dotfile-manager.ts` (DotfileManager class)
- Config file: `~/.dotfilesrc.toml` (TOML format, parsed with smol-toml)
- If config is missing, a default config is auto-created with `DEFAULT_CONFIG` constant
- Backup directory: `~/.dotfiles` (configurable via `settings.backup_dir`)
- Backup produces `~/.dotfiles-backup.tar.gz` archive (using tar package)
- Two commands: `backup` (default) and `restore`
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
- Vitest with globals enabled
- Coverage via v8 provider
