---
"create-dotfiles": minor
---

Add `env-example` and `env-sort` for a project's `.env` files. `env-example` writes `.env.example` as the union of the keys of `.env` and every `.env.*` file in a directory, with every value left empty; an existing `.env.example` is kept as it is and only missing keys are appended. Comments are copied only with `--keep-comments` (section headers always). `env-sort` sorts keys alphabetically, either inside each section opened by a `## ---` line (`--mode section`, the default) or across the whole file (`--mode all`); `--check` exits 1 instead of writing. Both are also available from the library as `EnvExample` and `EnvFile`.
