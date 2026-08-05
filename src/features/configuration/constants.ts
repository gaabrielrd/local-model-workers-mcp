export const CONFIGURATION_SCHEMA_VERSION = 1 as const;

export const PROJECT_PREFERENCES_FILENAME = ".local-model-workers.json";
export const CONFIGURATION_DIRECTORY_NAME = "local-model-workers";
export const GLOBAL_PREFERENCES_FILENAME = "preferences.json";

export const CONFIGURATION_ENVIRONMENT_VARIABLES = {
  lmStudioBaseUrl: "LMW_LM_STUDIO_BASE_URL",
  lmStudioBearerToken: "LMW_LM_STUDIO_BEARER_TOKEN",
  allowedModels: "LMW_ALLOWED_MODELS",
  providers: "LMW_PROVIDERS",
  providerRecheckIntervalMs: "LMW_PROVIDER_RECHECK_INTERVAL_MS",
} as const;

export const DEFAULT_PROVIDER_RECHECK_INTERVAL_MS = 60_000;

export const BUILT_IN_SUPERVISION = {
  enabled: true,
  interval_ms: 30_000,
  rss_limit_mb: 1_024,
  event_loop_lag_ms: 2_000,
} as const;

export const BUILT_IN_LIMITS = {
  max_concurrency: 2,
  queue_timeout_ms: 5 * 60 * 1_000,
  processing_timeout_ms: 10 * 60 * 1_000,
  max_exploration_interactions: 15,
  context_budget_bytes: 256 * 1_024,
} as const;

export const ADMINISTRATIVE_MAXIMA = {
  max_concurrency: 4,
  queue_timeout_ms: 15 * 60 * 1_000,
  processing_timeout_ms: 30 * 60 * 1_000,
  max_exploration_interactions: 50,
  context_budget_bytes: 1_024 * 1_024,
} as const;

export const FIXED_LIMITS = {
  patch_max_files: 10,
  patch_max_changed_lines: 1_000,
  inference_retry_count: 1,
} as const;

export const POST_PROCESSING_HOOKS_MAX = 8;
export const POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT = 30_000;
export const POST_PROCESSING_HOOK_TIMEOUT_MS_MAX = 120_000;
export const POST_PROCESSING_HOOK_CAPTURE_BYTES = 256 * 1_024;

export const PROFILE_PRESETS = {
  fast: {
    limits: {
      max_concurrency: 4,
      queue_timeout_ms: 60_000,
      processing_timeout_ms: 2 * 60_000,
      max_exploration_interactions: 6,
      context_budget_bytes: 96 * 1_024,
    },
  },
  thorough: {
    limits: {
      max_concurrency: 1,
      queue_timeout_ms: 10 * 60_000,
      processing_timeout_ms: 20 * 60_000,
      max_exploration_interactions: 30,
      context_budget_bytes: 512 * 1_024,
    },
  },
  balanced: {
    limits: {},
  },
} as const;

export const REDACTED_CONFIGURATION_VALUE = "[REDACTED]";
