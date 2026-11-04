export {
  type CollectOptions,
  type CollectProgress,
  type CollectSummary,
  Collector,
  type GroupCounts,
  type WriteOptions,
  ZipPassword,
  type ZipPasswordSource,
} from "./collect";
export {
  Config,
  type DotfilesConfig,
  type DotfilesSettings,
  Options,
  type OutputFormat,
  type PlanOptions,
  type ResolvedOptions,
} from "./config";
export * from "./constants";
export { DotfileError } from "./errors";
export {
  type FoundTarget,
  type FailedEntry,
  type MissingTarget,
  type Plan,
  type PlannedFile,
  Planner,
  type PlanOutputs,
  type PlanOverrides,
} from "./plan";
export {
  type Cancelled,
  type ConfirmPrompt,
  InteractiveSession,
  type InteractiveOptions,
  type InteractiveResult,
  type MultiselectPrompt,
  type PasswordPrompt,
  type Prompter,
  type SelectOption,
  type SpinnerHandle,
} from "./interactive";
export { Reporter } from "./report";
export { Restorer, type RestoreFailure, type RestoreOptions, type RestoreSummary } from "./restore";
export {
  ExcludeRules,
  type TargetCategory,
  type TargetGroup,
  type TargetPlatform,
  Targets,
  type TargetSpec,
} from "./targets";
