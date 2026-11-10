---
"create-dotfiles": minor
---

Internal restructuring, with no change to the CLI's behaviour or the library API: `ClackPrompter` now lives in `interactive.ts` next to the `Prompter` interface it implements, and test-only helpers moved to `src/tests/`.
