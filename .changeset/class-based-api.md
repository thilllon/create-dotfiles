---
"create-dotfiles": major
---

The library API is now a small set of classes instead of free functions: `Planner`, `Collector`, `Restorer`, `InteractiveSession`, `Reporter`, `Config`, `Options`, `Targets`, `ExcludeRules` and `ZipPassword`. For example `collect()` is now `Collector.collect()`, `resolveTargets()` is `Planner.plan()`, `writePlan(plan, options)` is `new Collector(plan, options).write()` and `restore()` is `Restorer.restore()`. Every constant is exported from one place, and `DEFAULT_TARGETS` is replaced by `Targets.forPlatform()`. The CLI's behaviour and output are unchanged.
