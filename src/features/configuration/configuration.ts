import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  BUILT_IN_SUPERVISION,
  CONFIGURATION_ENVIRONMENT_VARIABLES,
  CONFIGURATION_SCHEMA_VERSION,
  DEFAULT_PROVIDER_RECHECK_INTERVAL_MS,
  FIXED_LIMITS,
  POST_PROCESSING_HOOKS_MAX,
  POST_PROCESSING_HOOK_TIMEOUT_MS_MAX,
  PROFILE_PRESETS,
  REDACTED_CONFIGURATION_VALUE,
} from "./constants.js";
import {
  resolveGlobalPreferencesPath,
  resolveProjectPreferencesPath,
} from "./paths.js";

export const MODEL_TASK_TYPES = [
  "embedding",
  "exploration",
  "test_proposal",
  "lint_fix",
  "docs_generation",
  "summarization",
  "code_graph",
] as const;

export type ModelTaskType = (typeof MODEL_TASK_TYPES)[number];

export const FEATURE_GROUPS = ["exploration", "tests", "docs", "lint"] as const;

export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

const EnabledFeaturesSchema = z
  .array(z.enum(FEATURE_GROUPS))
  .min(1)
  .superRefine((features, context) => {
    if (new Set(features).size !== features.length) {
      context.addIssue({
        code: "custom",
        message: "Enabled feature groups must be unique.",
      });
    }
  });

const LimitsSchema = z
  .object({
    max_concurrency: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.max_concurrency)
      .optional(),
    queue_timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.queue_timeout_ms)
      .optional(),
    processing_timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.processing_timeout_ms)
      .optional(),
    max_exploration_interactions: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.max_exploration_interactions)
      .optional(),
    context_budget_bytes: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.context_budget_bytes)
      .optional(),
  })
  .strict();

export const ModelRoutingSchema = z
  .object({
    embedding: z.string().trim().min(1).max(256).optional(),
    exploration: z.string().trim().min(1).max(256).optional(),
    test_proposal: z.string().trim().min(1).max(256).optional(),
    lint_fix: z.string().trim().min(1).max(256).optional(),
    docs_generation: z.string().trim().min(1).max(256).optional(),
    summarization: z.string().trim().min(1).max(256).optional(),
    code_graph: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const CONFIGURATION_PROFILES = ["fast", "thorough", "balanced"] as const;

export type ConfigurationProfile = (typeof CONFIGURATION_PROFILES)[number];

export const RESULT_VERBOSITY_LEVELS = [
  "terse",
  "standard",
  "verbose",
] as const;

export type ResultVerbosity = (typeof RESULT_VERBOSITY_LEVELS)[number];

const DEFAULT_RESULT_VERBOSITY: ResultVerbosity = "standard";

export const PostProcessingHookSchema = z
  .object({
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().trim().min(1).max(4_096)).max(128).optional(),
    timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(POST_PROCESSING_HOOK_TIMEOUT_MS_MAX)
      .optional(),
  })
  .strict();

export const PostProcessingHooksSchema = z
  .array(PostProcessingHookSchema)
  .max(POST_PROCESSING_HOOKS_MAX);

export type PostProcessingHook = z.infer<typeof PostProcessingHookSchema>;

const SupervisionSchema = z
  .object({
    enabled: z.boolean().optional(),
    interval_ms: z.number().int().min(1_000).max(86_400_000).optional(),
    rss_limit_mb: z.number().int().min(64).max(1_048_576).optional(),
    event_loop_lag_ms: z.number().int().min(100).max(86_400_000).optional(),
  })
  .strict();

export const PreferencesSchema = z
  .object({
    schema_version: z.literal(CONFIGURATION_SCHEMA_VERSION),
    profile: z.enum(CONFIGURATION_PROFILES).optional(),
    default_model: z.string().trim().min(1).max(256).optional(),
    embedding_model: z.string().trim().min(1).max(256).optional(),
    model_routing: ModelRoutingSchema.optional(),
    steering_prompt: z.string().trim().min(1).max(2_000).optional(),
    enabled_features: EnabledFeaturesSchema.optional(),
    supervision: SupervisionSchema.optional(),
    limits: LimitsSchema.optional(),
    post_processing_hooks: PostProcessingHooksSchema.optional(),
    result_verbosity: z.enum(RESULT_VERBOSITY_LEVELS).optional(),
  })
  .strict();

export const ProjectPreferencesSchema = PreferencesSchema.omit({
  enabled_features: true,
  supervision: true,
});

const AllowedModelsSchema = z
  .array(z.string().trim().min(1).max(256))
  .min(1)
  .superRefine((models, context) => {
    if (new Set(models).size !== models.length) {
      context.addIssue({
        code: "custom",
        message: "Model identifiers must be unique.",
      });
    }
  });

const ProviderConfigurationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
    type: z.enum(["lm-studio", "ollama", "vllm", "localai"]),
    base_url: z.string().trim().min(1).max(2_048),
    bearer_token: z.string().trim().min(1).max(8_192).optional(),
    allowed_models: AllowedModelsSchema,
    priority: z.number().int().min(0).max(10_000),
    tls_verify: z.boolean().optional(),
  })
  .strict();

const ProvidersSchema = z
  .array(ProviderConfigurationSchema)
  .min(1)
  .max(16)
  .superRefine((providers, context) => {
    if (
      new Set(providers.map((provider) => provider.name)).size !==
      providers.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Provider names must be unique.",
      });
    }
  });

export type Preferences = z.infer<typeof PreferencesSchema>;
export type ProjectPreferences = z.infer<typeof ProjectPreferencesSchema>;
export interface ProtectedProviderConfiguration {
  readonly name: string;
  readonly type: "lm-studio" | "ollama" | "vllm" | "localai";
  readonly base_url: string;
  readonly bearer_token?: string;
  readonly allowed_models: readonly string[];
  readonly priority: number;
  /**
   * Require TLS certificate validation for this provider. Protected: it lives
   * in the process environment only, so repository content and editable
   * project/global preferences can never weaken it. Defaults to false, which
   * preserves the documented trusted-LAN posture.
   */
  readonly tls_verify?: boolean;
}

export interface EffectiveProviderConfiguration {
  readonly name: string;
  readonly type: ProtectedProviderConfiguration["type"];
  readonly base_url: string;
  readonly token_configured: boolean;
  readonly allowed_models: readonly string[];
  readonly priority: number;
}

export interface EffectiveLimits {
  readonly max_concurrency: number;
  readonly queue_timeout_ms: number;
  readonly processing_timeout_ms: number;
  readonly max_exploration_interactions: number;
  readonly context_budget_bytes: number;
}

export type ConfigurationOrigin =
  "protected" | "project" | "global" | "built_in";

export type ConfigurationErrorCode =
  | "invalid_configuration"
  | "configuration_conflict"
  | "confirmation_required"
  | "repository_not_found"
  | "repository_access_denied";

export class ConfigurationError extends Error {
  public readonly code: ConfigurationErrorCode;

  public constructor(code: ConfigurationErrorCode, message: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}

export interface ConfigurationFileSystem {
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  realpath(filePath: string): Promise<string>;
  stat(filePath: string): Promise<{ isDirectory(): boolean }>;
}

export interface GetConfigurationInput {
  readonly projectRoot?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly fileSystem?: ConfigurationFileSystem;
}

export interface EffectiveConfiguration {
  readonly schema_version: typeof CONFIGURATION_SCHEMA_VERSION;
  readonly revision: `sha256:${string}`;
  readonly lm_studio: {
    readonly base_url: string;
    readonly authentication: "bearer" | "none";
    readonly token_configured: boolean;
    readonly allowed_models: readonly string[];
    readonly default_model: string;
    readonly embedding_model?: string | undefined;
    readonly model_routing?:
      Readonly<Partial<Record<ModelTaskType, string>>> | undefined;
  };
  readonly steering_prompt?: string | undefined;
  readonly enabled_features?: readonly FeatureGroup[];
  readonly profile: ConfigurationProfile;
  readonly post_processing_hooks: readonly PostProcessingHook[];
  readonly result_verbosity: ResultVerbosity;
  readonly providers?: readonly EffectiveProviderConfiguration[];
  readonly provider_routing?: {
    readonly strategy: "priority";
    readonly recheck_interval_ms: number;
  };
  readonly limits: EffectiveLimits;
  readonly supervision: {
    readonly enabled: boolean;
    readonly interval_ms: number;
    readonly rss_limit_bytes: number;
    readonly event_loop_lag_ms: number;
  };
  readonly administrative_maxima: typeof ADMINISTRATIVE_MAXIMA;
  readonly fixed_limits: typeof FIXED_LIMITS;
  readonly origins: Readonly<Record<ConfigurationField, ConfigurationOrigin>>;
}

export interface EffectiveConfigurationView extends EffectiveConfiguration {
  readonly lm_studio: EffectiveConfiguration["lm_studio"] & {
    readonly bearer_token: typeof REDACTED_CONFIGURATION_VALUE | null;
  };
}

export type ConfigurationField =
  | "lm_studio.base_url"
  | "lm_studio.authentication"
  | "lm_studio.allowed_models"
  | "lm_studio.default_model"
  | "lm_studio.embedding_model"
  | `lm_studio.model_routing.${ModelTaskType}`
  | "steering_prompt"
  | "profile"
  | "post_processing_hooks"
  | "result_verbosity"
  | "limits.max_concurrency"
  | "limits.queue_timeout_ms"
  | "limits.processing_timeout_ms"
  | "limits.max_exploration_interactions"
  | "limits.context_budget_bytes"
  | "supervision.enabled"
  | "supervision.interval_ms"
  | "supervision.rss_limit_bytes"
  | "supervision.event_loop_lag_ms"
  | "administrative_maxima.max_concurrency"
  | "administrative_maxima.queue_timeout_ms"
  | "administrative_maxima.processing_timeout_ms"
  | "administrative_maxima.max_exploration_interactions"
  | "administrative_maxima.context_budget_bytes"
  | "fixed_limits.patch_max_files"
  | "fixed_limits.patch_max_changed_lines"
  | "fixed_limits.inference_retry_count";

const nodeFileSystem: ConfigurationFileSystem = { readFile, realpath, stat };

export async function getEffectiveConfiguration(
  input: GetConfigurationInput = {},
): Promise<EffectiveConfiguration> {
  const environment = input.environment ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDirectory = input.homeDirectory ?? os.homedir();
  const fileSystem = input.fileSystem ?? nodeFileSystem;
  const protectedSettings = parseProtectedSettings(environment);

  const globalPreferencesPath = resolveGlobalPreferencesPath({
    platform,
    homeDirectory,
    environment,
  });
  const globalPreferences = await readOptionalPreferences(
    globalPreferencesPath,
    "global",
    fileSystem,
  );
  const projectPreferences =
    input.projectRoot === undefined
      ? undefined
      : await readProjectPreferences(input.projectRoot, fileSystem);

  const defaultModel = selectOptionalValue(
    projectPreferences?.default_model,
    globalPreferences?.default_model,
    undefined,
  );
  if (defaultModel.value === undefined) {
    throw invalidConfiguration(
      "A default model is required in global or project preferences.",
    );
  }
  if (
    !protectedSettings.allowedModels.includes("*") &&
    !protectedSettings.allowedModels.includes(defaultModel.value)
  ) {
    throw invalidConfiguration(
      "The configured default model is not allowed by protected policy.",
    );
  }

  const profile: {
    readonly value: ConfigurationProfile | undefined;
    readonly origin: ConfigurationOrigin;
  } = selectOptionalValue(
    projectPreferences?.profile,
    globalPreferences?.profile,
    "balanced",
  );
  const activeProfile: ConfigurationProfile = profile.value ?? "balanced";
  const profileLimits = PROFILE_PRESETS[activeProfile]
    .limits as Partial<EffectiveLimits>;

  const concurrency = selectValue(
    projectPreferences?.limits?.max_concurrency,
    globalPreferences?.limits?.max_concurrency,
    profileLimits.max_concurrency ?? BUILT_IN_LIMITS.max_concurrency,
  );
  const queueTimeout = selectValue(
    projectPreferences?.limits?.queue_timeout_ms,
    globalPreferences?.limits?.queue_timeout_ms,
    profileLimits.queue_timeout_ms ?? BUILT_IN_LIMITS.queue_timeout_ms,
  );
  const processingTimeout = selectValue(
    projectPreferences?.limits?.processing_timeout_ms,
    globalPreferences?.limits?.processing_timeout_ms,
    profileLimits.processing_timeout_ms ??
      BUILT_IN_LIMITS.processing_timeout_ms,
  );
  const explorationInteractions = selectValue(
    projectPreferences?.limits?.max_exploration_interactions,
    globalPreferences?.limits?.max_exploration_interactions,
    profileLimits.max_exploration_interactions ??
      BUILT_IN_LIMITS.max_exploration_interactions,
  );
  const contextBudget = selectValue(
    projectPreferences?.limits?.context_budget_bytes,
    globalPreferences?.limits?.context_budget_bytes,
    profileLimits.context_budget_bytes ?? BUILT_IN_LIMITS.context_budget_bytes,
  );

  const postProcessingHooks = selectValue(
    projectPreferences?.post_processing_hooks,
    globalPreferences?.post_processing_hooks,
    [],
  );

  const resultVerbosity = selectValue(
    projectPreferences?.result_verbosity,
    globalPreferences?.result_verbosity,
    DEFAULT_RESULT_VERBOSITY,
  );
  const activeResultVerbosity: ResultVerbosity = resultVerbosity.value;

  const embeddingModel = selectOptionalValue(
    projectPreferences?.embedding_model,
    globalPreferences?.embedding_model,
    undefined,
  );
  if (
    embeddingModel.value !== undefined &&
    !protectedSettings.allowedModels.includes("*") &&
    !protectedSettings.allowedModels.includes(embeddingModel.value)
  ) {
    throw invalidConfiguration(
      "The configured embedding model is not allowed by protected policy.",
    );
  }

  const modelRouting = resolveModelRouting(
    projectPreferences?.model_routing,
    globalPreferences?.model_routing,
    embeddingModel,
    protectedSettings.allowedModels,
  );

  const steeringPrompt = selectOptionalValue(
    projectPreferences?.steering_prompt,
    globalPreferences?.steering_prompt,
    undefined,
  );
  const enabledFeatures = selectValue(
    undefined,
    globalPreferences?.enabled_features,
    [...FEATURE_GROUPS],
  );
  const supervisionEnabled = selectValue(
    undefined,
    globalPreferences?.supervision?.enabled,
    BUILT_IN_SUPERVISION.enabled,
  );
  const supervisionInterval = selectValue(
    undefined,
    globalPreferences?.supervision?.interval_ms,
    BUILT_IN_SUPERVISION.interval_ms,
  );
  const supervisionRssLimitMb = selectValue(
    undefined,
    globalPreferences?.supervision?.rss_limit_mb,
    BUILT_IN_SUPERVISION.rss_limit_mb,
  );
  const supervisionLag = selectValue(
    undefined,
    globalPreferences?.supervision?.event_loop_lag_ms,
    BUILT_IN_SUPERVISION.event_loop_lag_ms,
  );

  const origins: Record<ConfigurationField, ConfigurationOrigin> = {
    "lm_studio.base_url": "protected",
    "lm_studio.authentication": "protected",
    "lm_studio.allowed_models": "protected",
    "lm_studio.default_model": defaultModel.origin,
    "lm_studio.embedding_model": embeddingModel.origin,
    ...modelRouting.origins,
    steering_prompt: steeringPrompt.origin,
    profile: profile.origin,
    post_processing_hooks: postProcessingHooks.origin,
    result_verbosity: resultVerbosity.origin,
    "limits.max_concurrency": concurrency.origin,
    "limits.queue_timeout_ms": queueTimeout.origin,
    "limits.processing_timeout_ms": processingTimeout.origin,
    "limits.max_exploration_interactions": explorationInteractions.origin,
    "limits.context_budget_bytes": contextBudget.origin,
    "supervision.enabled": supervisionEnabled.origin,
    "supervision.interval_ms": supervisionInterval.origin,
    "supervision.rss_limit_bytes": supervisionRssLimitMb.origin,
    "supervision.event_loop_lag_ms": supervisionLag.origin,
    "administrative_maxima.max_concurrency": "protected",
    "administrative_maxima.queue_timeout_ms": "protected",
    "administrative_maxima.processing_timeout_ms": "protected",
    "administrative_maxima.max_exploration_interactions": "protected",
    "administrative_maxima.context_budget_bytes": "protected",
    "fixed_limits.patch_max_files": "protected",
    "fixed_limits.patch_max_changed_lines": "protected",
    "fixed_limits.inference_retry_count": "protected",
  };

  const revisionInput = {
    schema_version: CONFIGURATION_SCHEMA_VERSION,
    lm_studio: {
      base_url: protectedSettings.baseUrl,
      authentication: protectedSettings.tokenConfigured
        ? ("bearer" as const)
        : ("none" as const),
      token_configured: protectedSettings.tokenConfigured,
      allowed_models: protectedSettings.allowedModels,
      default_model: defaultModel.value,
      ...(embeddingModel.value !== undefined
        ? { embedding_model: embeddingModel.value }
        : {}),
      model_routing: modelRouting.values,
    },
    ...(steeringPrompt.value === undefined
      ? {}
      : { steering_prompt: steeringPrompt.value }),
    enabled_features: [...enabledFeatures.value],
    profile: activeProfile,
    result_verbosity: activeResultVerbosity,
    post_processing_hooks: postProcessingHooks.value.map((hook) => ({
      command: hook.command,
      ...(hook.args === undefined ? {} : { args: [...hook.args] }),
      ...(hook.timeout_ms === undefined ? {} : { timeout_ms: hook.timeout_ms }),
    })),
    providers: protectedSettings.providers.map((provider) => ({
      name: provider.name,
      type: provider.type,
      base_url: provider.base_url,
      token_configured:
        provider.bearer_token !== undefined && provider.bearer_token.length > 0,
      allowed_models: [...provider.allowed_models],
      priority: provider.priority,
    })),
    provider_routing: {
      strategy: "priority" as const,
      recheck_interval_ms: protectedSettings.recheckIntervalMs,
    },
    limits: {
      max_concurrency: concurrency.value,
      queue_timeout_ms: queueTimeout.value,
      processing_timeout_ms: processingTimeout.value,
      max_exploration_interactions: explorationInteractions.value,
      context_budget_bytes: contextBudget.value,
    },
    supervision: {
      enabled: supervisionEnabled.value,
      interval_ms: supervisionInterval.value,
      rss_limit_bytes: supervisionRssLimitMb.value * 1024 * 1024,
      event_loop_lag_ms: supervisionLag.value,
    },
    administrative_maxima: ADMINISTRATIVE_MAXIMA,
    fixed_limits: FIXED_LIMITS,
    origins,
  };
  const revision = `sha256:${createHash("sha256")
    .update(JSON.stringify(revisionInput))
    .digest("hex")}` as const;

  return deepFreeze({ ...revisionInput, revision });
}

export async function getConfig(
  input: GetConfigurationInput = {},
): Promise<EffectiveConfigurationView> {
  const configuration = await getEffectiveConfiguration(input);
  return deepFreeze({
    ...configuration,
    lm_studio: {
      ...configuration.lm_studio,
      bearer_token: configuration.lm_studio.token_configured
        ? REDACTED_CONFIGURATION_VALUE
        : null,
    },
  });
}

export interface ResolveModelOptions {
  readonly contextTokenCount?: number | undefined;
}

export function resolveModelForTask(
  configuration: EffectiveConfiguration,
  taskType: ModelTaskType,
  options?: ResolveModelOptions,
): string {
  const configured = configuration.lm_studio.model_routing?.[taskType];
  if (configured !== undefined) {
    return configured;
  }
  if (
    options?.contextTokenCount !== undefined &&
    options.contextTokenCount > 16_384
  ) {
    const largeContextModel = configuration.lm_studio.allowed_models.find(
      (model) =>
        /long|128k|64k|32k|large|qwen|deepseek/i.test(model) && model !== "*",
    );
    if (largeContextModel !== undefined) {
      return largeContextModel;
    }
  }
  if (taskType === "embedding") {
    const autoEmbeddingModel = configuration.lm_studio.allowed_models.find(
      (model) => /embed|nomic|bge|e5|gte|minilm/i.test(model) && model !== "*",
    );
    if (autoEmbeddingModel !== undefined) {
      return autoEmbeddingModel;
    }
  }
  return configuration.lm_studio.default_model;
}

async function readProjectPreferences(
  projectRoot: string,
  fileSystem: ConfigurationFileSystem,
): Promise<ProjectPreferences | undefined> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await fileSystem.realpath(projectRoot);
    const rootStats = await fileSystem.stat(canonicalRoot);
    if (!rootStats.isDirectory()) {
      throw new ConfigurationError(
        "repository_not_found",
        "The project root is not a directory.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw projectRootError(error);
  }

  const requestedPath = resolveProjectPreferencesPath(canonicalRoot);
  let canonicalPreferencesPath: string;
  try {
    canonicalPreferencesPath = await fileSystem.realpath(requestedPath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return undefined;
    }
    throw new ConfigurationError(
      "repository_access_denied",
      "The project preferences file cannot be accessed.",
    );
  }

  if (!isContainedPath(canonicalRoot, canonicalPreferencesPath)) {
    throw new ConfigurationError(
      "repository_access_denied",
      "The project preferences file resolves outside the project root.",
    );
  }

  return readRequiredPreferences(
    canonicalPreferencesPath,
    "project",
    fileSystem,
  );
}

async function readOptionalPreferences(
  preferencesPath: string,
  layer: "global",
  fileSystem: ConfigurationFileSystem,
): Promise<Preferences | undefined> {
  try {
    return await readRequiredPreferences(preferencesPath, layer, fileSystem);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function readRequiredPreferences(
  preferencesPath: string,
  layer: "global" | "project",
  fileSystem: ConfigurationFileSystem,
): Promise<Preferences | ProjectPreferences> {
  let contents: string;
  try {
    contents = await fileSystem.readFile(preferencesPath, "utf8");
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      throw error;
    }
    throw invalidConfiguration(`The ${layer} preferences file cannot be read.`);
  }

  try {
    const schema =
      layer === "global" ? PreferencesSchema : ProjectPreferencesSchema;
    return schema.parse(JSON.parse(contents) as unknown);
  } catch {
    throw invalidConfiguration(
      `The ${layer} preferences file is malformed or contains unsupported fields.`,
    );
  }
}

function parseProtectedSettings(
  environment: Readonly<Record<string, string | undefined>>,
): {
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly allowedModels: readonly string[];
  readonly providers: readonly ProtectedProviderConfiguration[];
  readonly recheckIntervalMs: number;
} {
  const providers = getProtectedProviderConfigurations(environment);
  const primaryProvider = providers[0];
  if (primaryProvider === undefined) {
    throw invalidConfiguration("At least one provider is required.");
  }
  const allowedModels = [
    ...new Set(providers.flatMap((provider) => provider.allowed_models)),
  ].sort();
  const rawInterval =
    environment[
      CONFIGURATION_ENVIRONMENT_VARIABLES.providerRecheckIntervalMs
    ]?.trim();
  const recheckIntervalMs =
    rawInterval === undefined || rawInterval.length === 0
      ? DEFAULT_PROVIDER_RECHECK_INTERVAL_MS
      : Number(rawInterval);
  if (!Number.isInteger(recheckIntervalMs) || recheckIntervalMs < 1) {
    throw invalidConfiguration(
      "The provider recheck interval must be a positive integer.",
    );
  }
  return {
    baseUrl: primaryProvider.base_url,
    tokenConfigured:
      primaryProvider.bearer_token !== undefined &&
      primaryProvider.bearer_token.length > 0,
    allowedModels,
    providers,
    recheckIntervalMs,
  };
}

export function getProtectedProviderConfigurations(
  environment: Readonly<Record<string, string | undefined>>,
): readonly ProtectedProviderConfiguration[] {
  const rawProviders =
    environment[CONFIGURATION_ENVIRONMENT_VARIABLES.providers]?.trim();
  if (rawProviders !== undefined && rawProviders.length > 0) {
    let parsed: z.infer<typeof ProvidersSchema>;
    try {
      parsed = ProvidersSchema.parse(JSON.parse(rawProviders) as unknown);
    } catch {
      throw invalidConfiguration(
        "The protected provider configuration is invalid.",
      );
    }
    return Object.freeze(
      parsed
        .map((provider) => ({
          name: provider.name,
          type: provider.type,
          base_url: normalizeProviderUrl(provider.base_url),
          ...(provider.bearer_token === undefined
            ? {}
            : { bearer_token: provider.bearer_token }),
          allowed_models: Object.freeze([...provider.allowed_models]),
          priority: provider.priority,
          ...(provider.tls_verify === undefined
            ? {}
            : { tls_verify: provider.tls_verify }),
        }))
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.name.localeCompare(right.name),
        ),
    );
  }
  const rawBaseUrlInput = requiredEnvironmentValue(
    environment,
    CONFIGURATION_ENVIRONMENT_VARIABLES.lmStudioBaseUrl,
  );
  const rawBaseUrl =
    rawBaseUrlInput.startsWith("${") && rawBaseUrlInput.includes("}")
      ? "http://localhost:1234/v1"
      : rawBaseUrlInput;
  const bearerToken =
    environment[
      CONFIGURATION_ENVIRONMENT_VARIABLES.lmStudioBearerToken
    ]?.trim();
  const rawAllowedModels =
    environment[CONFIGURATION_ENVIRONMENT_VARIABLES.allowedModels]?.trim();

  const baseUrl = normalizeProviderUrl(rawBaseUrl);

  let allowedModels: readonly string[];
  if (rawAllowedModels === undefined || rawAllowedModels.length === 0) {
    allowedModels = ["*"];
  } else {
    try {
      allowedModels = AllowedModelsSchema.parse(
        JSON.parse(rawAllowedModels) as unknown,
      );
    } catch {
      throw invalidConfiguration(
        "The protected allowed-model policy must be a JSON array of unique model identifiers.",
      );
    }
  }

  return Object.freeze([
    {
      name: "lm-studio",
      type: "lm-studio" as const,
      base_url: baseUrl,
      ...(bearerToken === undefined || bearerToken.length === 0
        ? {}
        : { bearer_token: bearerToken }),
      allowed_models: [...allowedModels].sort(),
      priority: 0,
    },
  ]);
}

function normalizeProviderUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidConfiguration("A protected provider base URL is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw invalidConfiguration(
      "Protected provider URLs must use HTTP(S) without embedded credentials.",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw invalidConfiguration(
      `Required protected setting ${name} is missing.`,
    );
  }
  return value.trim();
}

function selectValue<T>(
  projectValue: T | undefined,
  globalValue: T | undefined,
  builtInValue: T,
): { readonly value: T; readonly origin: ConfigurationOrigin } {
  if (projectValue !== undefined) {
    return { value: projectValue, origin: "project" };
  }
  if (globalValue !== undefined) {
    return { value: globalValue, origin: "global" };
  }
  return { value: builtInValue, origin: "built_in" };
}

function selectOptionalValue<T>(
  projectValue: T | undefined,
  globalValue: T | undefined,
  builtInValue: T | undefined,
): { readonly value: T | undefined; readonly origin: ConfigurationOrigin } {
  if (projectValue !== undefined) {
    return { value: projectValue, origin: "project" };
  }
  if (globalValue !== undefined) {
    return { value: globalValue, origin: "global" };
  }
  return { value: builtInValue, origin: "built_in" };
}

interface ResolvedModelRouting {
  readonly values: Readonly<Partial<Record<ModelTaskType, string>>>;
  readonly origins: Readonly<
    Record<`lm_studio.model_routing.${ModelTaskType}`, ConfigurationOrigin>
  >;
}

function resolveModelRouting(
  projectRouting: Preferences["model_routing"],
  globalRouting: Preferences["model_routing"],
  legacyEmbedding: {
    readonly value: string | undefined;
    readonly origin: ConfigurationOrigin;
  },
  allowedModels: readonly string[],
): ResolvedModelRouting {
  const values: Partial<Record<ModelTaskType, string>> = {};
  const origins = {} as Record<
    `lm_studio.model_routing.${ModelTaskType}`,
    ConfigurationOrigin
  >;
  for (const taskType of MODEL_TASK_TYPES) {
    let selected = selectOptionalValue(
      projectRouting?.[taskType],
      globalRouting?.[taskType],
      undefined,
    );
    if (selected.value === undefined && taskType === "embedding") {
      selected = {
        value: legacyEmbedding.value,
        origin: legacyEmbedding.origin,
      };
    }
    if (selected.value === undefined) {
      origins[`lm_studio.model_routing.${taskType}`] = "built_in";
      continue;
    }
    if (
      !allowedModels.includes("*") &&
      !allowedModels.includes(selected.value)
    ) {
      throw invalidConfiguration(
        `The configured model for the ${taskType} task is not allowed by protected policy.`,
      );
    }
    values[taskType] = selected.value;
    origins[`lm_studio.model_routing.${taskType}`] = selected.origin;
  }
  return { values, origins };
}

export function isContainedPath(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function projectRootError(error: unknown): ConfigurationError {
  if (isFileSystemError(error, "EACCES") || isFileSystemError(error, "EPERM")) {
    return new ConfigurationError(
      "repository_access_denied",
      "The project root cannot be accessed.",
    );
  }
  return new ConfigurationError(
    "repository_not_found",
    "The project root does not exist or is invalid.",
  );
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function invalidConfiguration(message: string): ConfigurationError {
  return new ConfigurationError("invalid_configuration", message);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}
