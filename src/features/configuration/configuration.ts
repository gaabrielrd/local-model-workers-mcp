import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  BUILT_IN_LIMITS,
  CONFIGURATION_ENVIRONMENT_VARIABLES,
  CONFIGURATION_SCHEMA_VERSION,
  FIXED_LIMITS,
  REDACTED_CONFIGURATION_VALUE,
} from "./constants.js";
import {
  resolveGlobalPreferencesPath,
  resolveProjectPreferencesPath,
} from "./paths.js";

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

export const PreferencesSchema = z
  .object({
    schema_version: z.literal(CONFIGURATION_SCHEMA_VERSION),
    default_model: z.string().trim().min(1).max(256).optional(),
    limits: LimitsSchema.optional(),
  })
  .strict();

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

export type Preferences = z.infer<typeof PreferencesSchema>;

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
  };
  readonly limits: EffectiveLimits;
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
  | "limits.max_concurrency"
  | "limits.queue_timeout_ms"
  | "limits.processing_timeout_ms"
  | "limits.max_exploration_interactions"
  | "limits.context_budget_bytes"
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

  const concurrency = selectValue(
    projectPreferences?.limits?.max_concurrency,
    globalPreferences?.limits?.max_concurrency,
    BUILT_IN_LIMITS.max_concurrency,
  );
  const queueTimeout = selectValue(
    projectPreferences?.limits?.queue_timeout_ms,
    globalPreferences?.limits?.queue_timeout_ms,
    BUILT_IN_LIMITS.queue_timeout_ms,
  );
  const processingTimeout = selectValue(
    projectPreferences?.limits?.processing_timeout_ms,
    globalPreferences?.limits?.processing_timeout_ms,
    BUILT_IN_LIMITS.processing_timeout_ms,
  );
  const explorationInteractions = selectValue(
    projectPreferences?.limits?.max_exploration_interactions,
    globalPreferences?.limits?.max_exploration_interactions,
    BUILT_IN_LIMITS.max_exploration_interactions,
  );
  const contextBudget = selectValue(
    projectPreferences?.limits?.context_budget_bytes,
    globalPreferences?.limits?.context_budget_bytes,
    BUILT_IN_LIMITS.context_budget_bytes,
  );

  const origins: Record<ConfigurationField, ConfigurationOrigin> = {
    "lm_studio.base_url": "protected",
    "lm_studio.authentication": "protected",
    "lm_studio.allowed_models": "protected",
    "lm_studio.default_model": defaultModel.origin,
    "limits.max_concurrency": concurrency.origin,
    "limits.queue_timeout_ms": queueTimeout.origin,
    "limits.processing_timeout_ms": processingTimeout.origin,
    "limits.max_exploration_interactions": explorationInteractions.origin,
    "limits.context_budget_bytes": contextBudget.origin,
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
    },
    limits: {
      max_concurrency: concurrency.value,
      queue_timeout_ms: queueTimeout.value,
      processing_timeout_ms: processingTimeout.value,
      max_exploration_interactions: explorationInteractions.value,
      context_budget_bytes: contextBudget.value,
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

async function readProjectPreferences(
  projectRoot: string,
  fileSystem: ConfigurationFileSystem,
): Promise<Preferences | undefined> {
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
): Promise<Preferences> {
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
    return PreferencesSchema.parse(JSON.parse(contents) as unknown);
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
} {
  const rawBaseUrl = requiredEnvironmentValue(
    environment,
    CONFIGURATION_ENVIRONMENT_VARIABLES.lmStudioBaseUrl,
  );
  const bearerToken =
    environment[
      CONFIGURATION_ENVIRONMENT_VARIABLES.lmStudioBearerToken
    ]?.trim();
  const rawAllowedModels =
    environment[CONFIGURATION_ENVIRONMENT_VARIABLES.allowedModels]?.trim();

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw invalidConfiguration("The protected LM Studio base URL is invalid.");
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0
  ) {
    throw invalidConfiguration(
      "The protected LM Studio base URL must use HTTP(S) without embedded credentials.",
    );
  }

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

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    tokenConfigured: bearerToken !== undefined && bearerToken.length > 0,
    allowedModels: [...allowedModels].sort(),
  };
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
