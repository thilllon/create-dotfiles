export {
  type CollectOptions,
  type CollectProgress,
  type CollectSummary,
  collect,
  countByGroup,
  type GroupCounts,
  type WriteOptions,
  writePlan,
} from "./collect";
export {
  CONFIG_FILE,
  type DotfilesConfig,
  type DotfilesSettings,
  loadConfig,
  parseConfig,
} from "./config";
export { DotfileError } from "./errors";
export { OUTPUT_FORMATS, type OutputFormat, parseFormats } from "./formats";
export {
  CANCEL,
  type Cancelled,
  type ConfirmPrompt,
  type InteractiveOptions,
  type InteractiveResult,
  type MultiselectPrompt,
  type Prompter,
  runInteractive,
  type SelectOption,
  type SpinnerHandle,
} from "./interactive";
export {
  DEFAULT_FORMATS,
  DEFAULT_MAX_FILE_SIZE_MB,
  type PlanOptions,
  type ResolvedOptions,
  resolveOptions,
} from "./options";
export {
  collectionName,
  ENV_SCAN_TARGET,
  type FailedEntry,
  type FoundTarget,
  filterPlan,
  type MissingTarget,
  type Plan,
  type PlannedFile,
  type PlanOutputs,
  type PlanOverrides,
  resolveTargets,
  scanEnvFiles,
} from "./plan";
export {
  formatBytes,
  formatFoundTargets,
  formatNeverCopied,
  formatRestoreSummary,
  formatSummary,
} from "./report";
export {
  findLatestCollection,
  type RestoreFailure,
  type RestoreOptions,
  type RestoreSummary,
  restore,
} from "./restore";
export {
  COLLECTION_NAME_PATTERN,
  DEFAULT_TARGETS,
  ENV_SCAN_MAX_DEPTH,
  ENV_SCAN_SKIPPED_FOLDERS,
  HARD_EXCLUDED_DIR_NAMES,
  isEnvFile,
  isExcluded,
  isHardExcluded,
  type TargetGroup,
  type TargetSpec,
} from "./targets";
