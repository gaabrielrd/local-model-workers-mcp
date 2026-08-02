import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  ADMINISTRATIVE_MAXIMA,
  CONFIGURATION_SCHEMA_VERSION,
} from "./constants.js";
import {
  ConfigurationError,
  PreferencesSchema,
  getEffectiveConfiguration,
  isContainedPath,
  type ConfigurationFileSystem,
  type ConfigurationOrigin,
  type EffectiveConfiguration,
  type GetConfigurationInput,
  type Preferences,
} from "./configuration.js";
import { resolveProjectPreferencesPath } from "./paths.js";

const MutableLimitsSchema = z
  .object({
    max_concurrency: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.max_concurrency)
      .nullable()
      .optional(),
    queue_timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.queue_timeout_ms)
      .nullable()
      .optional(),
    processing_timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.processing_timeout_ms)
      .nullable()
      .optional(),
    max_exploration_interactions: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.max_exploration_interactions)
      .nullable()
      .optional(),
    context_budget_bytes: z
      .number()
      .int()
      .min(1)
      .max(ADMINISTRATIVE_MAXIMA.context_budget_bytes)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((limits) => Object.keys(limits).length > 0, {
    message: "At least one limit change is required.",
  });

const ProjectChangesSchema = z
  .object({
    default_model: z.string().trim().min(1).max(256).nullable().optional(),
    limits: MutableLimitsSchema.optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one project preference change is required.",
  });

const RevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ConfirmationSchema = z
  .object({
    approved: z.literal(true),
    proposal_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

type ProjectChanges = z.infer<typeof ProjectChangesSchema>;

export type ConfigurationValidationIssueCode =
  | "invalid_proposal"
  | "protected_field"
  | "configuration_conflict"
  | "no_changes";

export interface ConfigurationValidationIssue {
  readonly code: ConfigurationValidationIssueCode;
  readonly field: string;
  readonly message: string;
}

export interface ConfigurationChange {
  readonly field: MutableConfigurationField;
  readonly old_value: string | number;
  readonly new_value: string | number;
  readonly old_origin: ConfigurationOrigin;
  readonly new_origin: ConfigurationOrigin;
}

export interface ValidConfigurationProposal {
  readonly valid: true;
  readonly expected_revision: `sha256:${string}`;
  readonly proposal_id: `sha256:${string}`;
  readonly changes: readonly ConfigurationChange[];
  readonly proposed_configuration: EffectiveConfiguration;
}

export interface InvalidConfigurationProposal {
  readonly valid: false;
  readonly errors: readonly ConfigurationValidationIssue[];
}

export type ValidateConfigurationResult =
  ValidConfigurationProposal | InvalidConfigurationProposal;

export interface ConfigurationConfirmation {
  readonly approved: true;
  readonly proposal_id: `sha256:${string}`;
}

export interface ValidateConfigurationInput extends GetConfigurationInput {
  readonly projectRoot: string;
  readonly expected_revision: string;
  readonly changes: unknown;
}

export interface UpdateConfigurationInput extends ValidateConfigurationInput {
  readonly confirmation?: unknown;
  readonly atomicWriter?: AtomicConfigurationWriter;
}

export interface UpdateConfigurationResult {
  readonly updated: true;
  readonly changed_fields: readonly ConfigurationChange[];
  readonly old_revision: `sha256:${string}`;
  readonly new_revision: `sha256:${string}`;
  readonly configuration: EffectiveConfiguration;
}

export interface AtomicConfigurationWriter {
  write(targetPath: string, contents: string): Promise<void>;
}

export interface AtomicWriteHandle {
  writeFile(contents: string, options: { encoding: "utf8" }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriteOperations {
  open(filePath: string, flags: "wx", mode: number): Promise<AtomicWriteHandle>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  rm(filePath: string, options: { force: true }): Promise<void>;
}

type MutableConfigurationField =
  | "lm_studio.default_model"
  | "limits.max_concurrency"
  | "limits.queue_timeout_ms"
  | "limits.processing_timeout_ms"
  | "limits.max_exploration_interactions"
  | "limits.context_budget_bytes";

interface PreparedProposal extends ValidConfigurationProposal {
  readonly targetPath: string;
  readonly serializedPreferences: string;
}

const mutableFields: readonly MutableConfigurationField[] = [
  "lm_studio.default_model",
  "limits.max_concurrency",
  "limits.queue_timeout_ms",
  "limits.processing_timeout_ms",
  "limits.max_exploration_interactions",
  "limits.context_budget_bytes",
];

const protectedProposalFields = new Set([
  "lm_studio",
  "base_url",
  "bearer_token",
  "allowed_models",
  "administrative_maxima",
  "fixed_limits",
  "schema_version",
]);

const nodeFileSystem: ConfigurationFileSystem = { readFile, realpath, stat };
const nodeAtomicOperations: AtomicWriteOperations = {
  open: async (filePath, flags, mode) => open(filePath, flags, mode),
  rename,
  rm,
};
const defaultAtomicWriter: AtomicConfigurationWriter = {
  write: (targetPath, contents) =>
    writeConfigurationFileAtomically(targetPath, contents),
};
const mutationLocks = new Map<string, Promise<void>>();

export async function validateConfig(
  input: ValidateConfigurationInput,
): Promise<ValidateConfigurationResult> {
  const prepared = await prepareProposal(input);
  if ("errors" in prepared) {
    return deepFreeze(prepared);
  }
  return deepFreeze({
    valid: true,
    expected_revision: prepared.expected_revision,
    proposal_id: prepared.proposal_id,
    changes: prepared.changes,
    proposed_configuration: prepared.proposed_configuration,
  });
}

export async function updateConfig(
  input: UpdateConfigurationInput,
): Promise<UpdateConfigurationResult> {
  const confirmation = ConfirmationSchema.safeParse(input.confirmation);
  if (!confirmation.success) {
    throw new ConfigurationError(
      "confirmation_required",
      "Explicit confirmation for this configuration proposal is required.",
    );
  }

  const canonicalRoot = await canonicalizeProjectRoot(
    input.projectRoot,
    input.fileSystem ?? nodeFileSystem,
  );
  return withMutationLock(canonicalRoot, async () => {
    const prepared = await prepareProposal(input);
    if ("errors" in prepared) {
      const conflict = prepared.errors.some(
        (issue) => issue.code === "configuration_conflict",
      );
      throw new ConfigurationError(
        conflict ? "configuration_conflict" : "invalid_configuration",
        conflict
          ? "The expected configuration revision is stale."
          : "The project configuration proposal is invalid.",
      );
    }
    if (confirmation.data.proposal_id !== prepared.proposal_id) {
      throw new ConfigurationError(
        "confirmation_required",
        "Confirmation does not match this proposal and revision.",
      );
    }

    const writer = input.atomicWriter ?? defaultAtomicWriter;
    try {
      await writer.write(prepared.targetPath, prepared.serializedPreferences);
    } catch {
      throw new ConfigurationError(
        "invalid_configuration",
        "The project preferences update could not be committed atomically.",
      );
    }

    const configuration = await getEffectiveConfiguration(
      configurationInput(input),
    );
    return deepFreeze({
      updated: true,
      changed_fields: prepared.changes,
      old_revision: prepared.expected_revision,
      new_revision: configuration.revision,
      configuration,
    });
  });
}

export async function writeConfigurationFileAtomically(
  targetPath: string,
  contents: string,
  operations: AtomicWriteOperations = nodeAtomicOperations,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: AtomicWriteHandle | undefined;
  try {
    handle = await operations.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await operations.rename(temporaryPath, targetPath);
  } catch (error: unknown) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await operations.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function prepareProposal(
  input: ValidateConfigurationInput,
): Promise<PreparedProposal | InvalidConfigurationProposal> {
  const protectedIssue = findProtectedField(input.changes);
  if (protectedIssue !== undefined) {
    return { valid: false, errors: [protectedIssue] };
  }
  const revision = RevisionSchema.safeParse(input.expected_revision);
  if (!revision.success) {
    return invalidProposal(
      "expected_revision",
      "Expected revision is invalid.",
    );
  }
  const changes = ProjectChangesSchema.safeParse(input.changes);
  if (!changes.success) {
    return {
      valid: false,
      errors: changes.error.issues.map((issue) => ({
        code: "invalid_proposal",
        field: issue.path.join(".") || "changes",
        message: "The proposed project preference is invalid.",
      })),
    };
  }

  const fileSystem = input.fileSystem ?? nodeFileSystem;
  const canonicalRoot = await canonicalizeProjectRoot(
    input.projectRoot,
    fileSystem,
  );
  const targetPath = resolveProjectPreferencesPath(canonicalRoot);
  const currentConfiguration = await getEffectiveConfiguration(
    configurationInput(input),
  );
  if (currentConfiguration.revision !== revision.data) {
    return {
      valid: false,
      errors: [
        {
          code: "configuration_conflict",
          field: "expected_revision",
          message: "The expected configuration revision is stale.",
        },
      ],
    };
  }

  const currentPreferences = await readCurrentPreferences(
    canonicalRoot,
    targetPath,
    fileSystem,
  );
  const proposedPreferences = applyChanges(currentPreferences, changes.data);
  const serializedPreferences = `${JSON.stringify(proposedPreferences, null, 2)}\n`;
  const proposedConfiguration = await getEffectiveConfiguration({
    ...configurationInput(input),
    fileSystem: overlayProjectPreferences(
      fileSystem,
      targetPath,
      serializedPreferences,
    ),
  });
  const effectiveChanges = compareConfigurations(
    currentConfiguration,
    proposedConfiguration,
  );
  if (
    JSON.stringify(currentPreferences) ===
      JSON.stringify(proposedPreferences) ||
    effectiveChanges.length === 0
  ) {
    return {
      valid: false,
      errors: [
        {
          code: "no_changes",
          field: "changes",
          message:
            "The proposal does not change effective project preferences.",
        },
      ],
    };
  }

  const proposalId = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        expected_revision: revision.data,
        changes: changes.data,
      }),
    )
    .digest("hex")}` as const;

  return {
    valid: true,
    expected_revision: revision.data,
    proposal_id: proposalId,
    changes: effectiveChanges,
    proposed_configuration: proposedConfiguration,
    targetPath,
    serializedPreferences,
  };
}

function applyChanges(
  current: Preferences,
  changes: ProjectChanges,
): Preferences {
  const currentLimits = Object.fromEntries(
    Object.entries(current.limits ?? {}).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
  const candidate: {
    schema_version: typeof CONFIGURATION_SCHEMA_VERSION;
    default_model?: string;
    limits?: Record<string, number>;
  } = {
    schema_version: CONFIGURATION_SCHEMA_VERSION,
    ...(current.default_model === undefined
      ? {}
      : { default_model: current.default_model }),
    ...(Object.keys(currentLimits).length === 0
      ? {}
      : { limits: currentLimits }),
  };

  if ("default_model" in changes) {
    if (changes.default_model === null) {
      delete candidate.default_model;
    } else if (changes.default_model !== undefined) {
      candidate.default_model = changes.default_model;
    }
  }

  if (changes.limits !== undefined) {
    const nextLimits: Record<string, number> = { ...candidate.limits };
    for (const [field, value] of Object.entries(changes.limits)) {
      if (value === null) {
        delete nextLimits[field];
      } else if (value !== undefined) {
        nextLimits[field] = value;
      }
    }
    if (Object.keys(nextLimits).length === 0) {
      delete candidate.limits;
    } else {
      candidate.limits = nextLimits;
    }
  }

  return PreferencesSchema.parse(candidate);
}

async function readCurrentPreferences(
  canonicalRoot: string,
  targetPath: string,
  fileSystem: ConfigurationFileSystem,
): Promise<Preferences> {
  let canonicalPath: string;
  try {
    canonicalPath = await fileSystem.realpath(targetPath);
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return { schema_version: CONFIGURATION_SCHEMA_VERSION };
    }
    throw new ConfigurationError(
      "repository_access_denied",
      "The project preferences file cannot be accessed.",
    );
  }
  if (!isContainedPath(canonicalRoot, canonicalPath)) {
    throw new ConfigurationError(
      "repository_access_denied",
      "The project preferences file resolves outside the project root.",
    );
  }
  try {
    return PreferencesSchema.parse(
      JSON.parse(await fileSystem.readFile(canonicalPath, "utf8")) as unknown,
    );
  } catch {
    throw new ConfigurationError(
      "invalid_configuration",
      "The project preferences file is malformed or contains unsupported fields.",
    );
  }
}

function overlayProjectPreferences(
  fileSystem: ConfigurationFileSystem,
  targetPath: string,
  contents: string,
): ConfigurationFileSystem {
  return {
    readFile: (filePath, encoding) =>
      filePath === targetPath
        ? Promise.resolve(contents)
        : fileSystem.readFile(filePath, encoding),
    realpath: (filePath) =>
      filePath === targetPath
        ? Promise.resolve(targetPath)
        : fileSystem.realpath(filePath),
    stat: (filePath) => fileSystem.stat(filePath),
  };
}

function compareConfigurations(
  current: EffectiveConfiguration,
  proposed: EffectiveConfiguration,
): readonly ConfigurationChange[] {
  const changes: ConfigurationChange[] = [];
  for (const field of mutableFields) {
    const oldValue = effectiveValue(current, field);
    const newValue = effectiveValue(proposed, field);
    const oldOrigin = current.origins[field];
    const newOrigin = proposed.origins[field];
    if (oldValue !== newValue || oldOrigin !== newOrigin) {
      changes.push({
        field,
        old_value: oldValue,
        new_value: newValue,
        old_origin: oldOrigin,
        new_origin: newOrigin,
      });
    }
  }
  return changes;
}

function effectiveValue(
  configuration: EffectiveConfiguration,
  field: MutableConfigurationField,
): string | number {
  switch (field) {
    case "lm_studio.default_model":
      return configuration.lm_studio.default_model;
    case "limits.max_concurrency":
      return configuration.limits.max_concurrency;
    case "limits.queue_timeout_ms":
      return configuration.limits.queue_timeout_ms;
    case "limits.processing_timeout_ms":
      return configuration.limits.processing_timeout_ms;
    case "limits.max_exploration_interactions":
      return configuration.limits.max_exploration_interactions;
    case "limits.context_budget_bytes":
      return configuration.limits.context_budget_bytes;
  }
}

async function canonicalizeProjectRoot(
  projectRoot: string,
  fileSystem: ConfigurationFileSystem,
): Promise<string> {
  try {
    const canonicalRoot = await fileSystem.realpath(projectRoot);
    if (!(await fileSystem.stat(canonicalRoot)).isDirectory()) {
      throw new ConfigurationError(
        "repository_not_found",
        "The project root is not a directory.",
      );
    }
    return canonicalRoot;
  } catch (error: unknown) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      isFileSystemError(error, "EACCES") || isFileSystemError(error, "EPERM")
        ? "repository_access_denied"
        : "repository_not_found",
      "The project root does not exist, is invalid, or cannot be accessed.",
    );
  }
}

function configurationInput(
  input: ValidateConfigurationInput,
): GetConfigurationInput & { projectRoot: string } {
  return {
    projectRoot: input.projectRoot,
    ...(input.environment === undefined
      ? {}
      : { environment: input.environment }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.homeDirectory === undefined
      ? {}
      : { homeDirectory: input.homeDirectory }),
    ...(input.fileSystem === undefined ? {} : { fileSystem: input.fileSystem }),
  };
}

function findProtectedField(
  changes: unknown,
): ConfigurationValidationIssue | undefined {
  if (
    typeof changes !== "object" ||
    changes === null ||
    Array.isArray(changes)
  ) {
    return undefined;
  }
  for (const field of Object.keys(changes)) {
    if (protectedProposalFields.has(field)) {
      return {
        code: "protected_field",
        field,
        message: "Protected configuration cannot be changed by project tools.",
      };
    }
  }
  return undefined;
}

function invalidProposal(
  field: string,
  message: string,
): InvalidConfigurationProposal {
  return {
    valid: false,
    errors: [{ code: "invalid_proposal", field, message }],
  };
}

async function withMutationLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = mutationLocks.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  mutationLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (mutationLocks.get(key) === tail) {
      mutationLocks.delete(key);
    }
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
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
