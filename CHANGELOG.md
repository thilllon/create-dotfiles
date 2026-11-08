# create-dotfiles

## 3.0.1

### Patch Changes

- chore(deps-dev): bump the npm-minor-patch group with 3 updates (#48)

## 3.0.0

### Major Changes

- 07746c3: The library API is now a small set of classes instead of free functions: `Planner`, `Collector`, `Restorer`, `InteractiveSession`, `Reporter`, `Config`, `Options`, `Targets`, `ExcludeRules` and `ZipPassword`. For example `collect()` is now `Collector.collect()`, `resolveTargets()` is `Planner.plan()`, `writePlan(plan, options)` is `new Collector(plan, options).write()` and `restore()` is `Restorer.restore()`. Every constant is exported from one place, and `DEFAULT_TARGETS` is replaced by `Targets.forPlatform()`. The CLI's behaviour and output are unchanged.

  Trailing slashes in config `include`/`exclude` entries are now trimmed with a linear loop instead of a regular expression that backtracked polynomially on long runs of `/` (CodeQL js/polynomial-redos).

  Migration from 2.x:

  | 2.x                                                                                                                            | 3.x                                                                                                      |
  | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
  | `collect(o)`                                                                                                                   | `Collector.collect(o)`                                                                                   |
  | `writePlan(plan, o)`                                                                                                           | `new Collector(plan, o).write()`                                                                         |
  | `countByGroup`                                                                                                                 | `Collector.countByGroup`                                                                                 |
  | `resolveTargets(o)` / `filterPlan` / `scanEnvFiles` / `collectionName`                                                         | `Planner.plan(o)` / `Planner.filter` / `Planner.scanEnvFiles` / `Planner.collectionName`                 |
  | `restore(o)` / `findLatestCollection`                                                                                          | `Restorer.restore(o)` / `Restorer.findLatestCollection`                                                  |
  | `runInteractive(p, o)`                                                                                                         | `new InteractiveSession(p, o).run()`                                                                     |
  | `formatSummary` / `formatRestoreSummary` / `formatFoundTargets` / `formatNeverCopied` / `formatBytes` / `outputEncryptionNote` | `Reporter.summary` / `.restoreSummary` / `.foundTargets` / `.neverCopied` / `.bytes` / `.encryptionNote` |
  | `loadConfig` / `parseConfig`                                                                                                   | `Config.load` / `Config.parse`                                                                           |
  | `resolveOptions` / `parseFormats`                                                                                              | `Options.resolve` / `Options.parseFormats`                                                               |
  | `targetsFor(p)` / `resolveTargetPlatform` / `isEnvFile` / `isHardExcluded`                                                     | `Targets.forPlatform(p)` / `.resolvePlatform` / `.isEnvFile` / `.isHardExcluded`                         |
  | `DEFAULT_TARGETS`                                                                                                              | `Targets.forPlatform()`                                                                                  |
  | `isExcluded(path, compileExcludes(entries))`                                                                                   | `new ExcludeRules(entries).matches(path)`                                                                |
  | `zipPasswordProblem` / `assertZipPassword` / `generateZipPassword` / `zipPasswordFromEnv` / `requireZipPasswordFromEnv`        | `ZipPassword.problem` / `.assert` / `.generate` / `.fromEnv` / `.requireFromEnv`                         |

  Constants keep their names and are all exported from the package root. The CLI is unchanged.

## 2.4.8

### Patch Changes

- chore(deps-dev): bump the npm-minor-patch group across 1 directory with 4 updates (#45)

## 2.4.7

### Patch Changes

- 1975afd: Releases are now versioned with Changesets and published when a change is merged; the package itself is unchanged.
