# create-dotfiles

Sync dotfiles between your home directory and a backup folder.

## Usage

```bash
npx create-dotfiles            # back up dotfiles listed in ~/.dotfilesrc.toml
npx create-dotfiles restore    # restore them back into your home directory
npx create-dotfiles restore --force   # overwrite files that already exist
```

On first run a default `~/.dotfilesrc.toml` is created for you.

## Configuration

`~/.dotfilesrc.toml` lists what to sync:

```toml
[settings]
backup_dir = ".dotfiles"

[files]
list = [
  ".zshrc",
  ".gitconfig",
  ".config/nvim",
]
```

- `backup_dir` — where copies live, relative to your home directory (default `.dotfiles`).
- `files.list` — paths relative to your home directory. Files and directories are both fine.

Paths must stay inside your home directory; absolute paths and `..` are rejected.

## Behaviour

- **Backup** copies each entry into `backup_dir`, then writes `~/.dotfiles-backup.tar.gz`.
  Symlinks are followed and their contents copied, so the archive is self-contained and
  restores cleanly on another machine.
- **Restore** copies entries from `backup_dir` back into your home directory. Existing files
  are left untouched unless you pass `--force`.
- A file that cannot be copied is reported as `[FAIL]` and the run continues.

## License

MIT
