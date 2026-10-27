# Changesets

A pull request that changes what users get from npm adds a changeset: run `pnpm changeset`, pick
the bump (patch, minor or major) and write the line that goes into `CHANGELOG.md`. A pull request
without a changeset (docs, CI, tests, tooling) releases nothing.

After a merge to `main`, `.github/workflows/release.yml` turns the pending changesets into a
version bump and a `CHANGELOG.md` entry, commits `chore(release): v<version>`, and publishes that
commit to npm. See "CI and releases" in `AGENTS.md`.
