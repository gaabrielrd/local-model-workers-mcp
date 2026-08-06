import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  PreferencesSchema,
  resolveGlobalPreferencesPath,
  writeConfigurationFileAtomically,
  type Preferences,
} from "../configuration/index.js";
import { resolveProvidersValue } from "./provider-migration.js";
import type { HarnessConfirmation, InstallationState } from "./harnesses.js";

export interface ProposeGlobalPreferencesInput {
  readonly preferences: unknown;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory: string;
}

export interface GlobalPreferencesProposal {
  readonly target_path: string;
  readonly state: InstallationState;
  readonly applicable: boolean;
  readonly requires_confirmation: boolean;
  readonly proposal_id: `sha256:${string}`;
  readonly expected_revision: `sha256:${string}`;
  readonly preview: readonly string[];
  readonly preferences: Preferences;
}

export async function proposeGlobalPreferences(
  input: ProposeGlobalPreferencesInput,
): Promise<GlobalPreferencesProposal> {
  const parsed = PreferencesSchema.safeParse(input.preferences);
  if (!parsed.success) {
    throw new Error("Global preferences must use the strict editable schema.");
  }
  const targetPath = resolveGlobalPreferencesPath({
    platform: input.platform ?? process.platform,
    homeDirectory: input.homeDirectory,
    environment: input.environment ?? process.env,
  });
  const currentContents = await readOptionalFile(targetPath);
  const currentPreferences = parseCurrentPreferences(currentContents);
  const proposedPreferences = mergePreferences(currentPreferences, parsed.data);
  validateDefaultModel(proposedPreferences, input.environment ?? process.env);
  const proposedContents = `${JSON.stringify(proposedPreferences, undefined, 2)}\n`;
  const state: InstallationState =
    currentContents === undefined
      ? "fresh"
      : currentPreferences === undefined
        ? "malformed"
        : deepEqual(currentPreferences, proposedPreferences)
          ? "identical"
          : "conflicting";
  const expectedRevision = revision(currentContents);
  const proposedRevision = revision(proposedContents);
  const proposalId = hash(
    JSON.stringify({ targetPath, expectedRevision, proposedRevision }),
  );

  return Object.freeze({
    target_path: targetPath,
    state,
    applicable: state !== "malformed",
    requires_confirmation: state !== "identical" && state !== "malformed",
    proposal_id: proposalId,
    expected_revision: expectedRevision,
    preview: Object.freeze(
      state === "malformed"
        ? ["manual repair required; no write will be attempted"]
        : proposedContents.trimEnd().split("\n"),
    ),
    preferences: Object.freeze(proposedPreferences),
  });
}

export async function applyGlobalPreferences(input: {
  readonly proposal: GlobalPreferencesProposal;
  readonly confirmation?: HarnessConfirmation;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory: string;
}): Promise<{
  readonly target_path: string;
  readonly outcome: "unchanged" | "written";
}> {
  const current = await proposeGlobalPreferences({
    preferences: input.proposal.preferences,
    homeDirectory: input.homeDirectory,
    ...(input.environment === undefined
      ? {}
      : { environment: input.environment }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
  });
  if (current.proposal_id !== input.proposal.proposal_id) {
    throw new Error("Global preferences changed after the proposal.");
  }
  if (!current.applicable) {
    throw new Error("Global preferences cannot be updated safely.");
  }
  if (current.state === "identical") {
    return { target_path: current.target_path, outcome: "unchanged" };
  }
  if (
    input.confirmation?.approved !== true ||
    input.confirmation.proposal_id !== current.proposal_id
  ) {
    throw new Error("Explicit confirmation for this proposal is required.");
  }

  await mkdir(path.dirname(current.target_path), {
    recursive: true,
    mode: 0o700,
  });
  await writeConfigurationFileAtomically(
    current.target_path,
    `${JSON.stringify(current.preferences, undefined, 2)}\n`,
  );
  return { target_path: current.target_path, outcome: "written" };
}

function validateDefaultModel(
  preferences: Preferences,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (preferences.default_model === undefined) {
    return;
  }
  const allowedModels = protectedAllowedModels(environment);
  if (allowedModels === undefined) {
    return;
  }
  if (
    !allowedModels.includes("*") &&
    !allowedModels.includes(preferences.default_model)
  ) {
    throw new Error(
      "The global default model is not allowed by protected policy.",
    );
  }
}

/**
 * The union of models the configured providers allow.
 *
 * Returns `undefined` when no policy is declared, which is not a failure: setup
 * runs before providers exist. A declared but unreadable policy is a failure,
 * because silently skipping it would let a disallowed default through.
 */
function protectedAllowedModels(
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] | undefined {
  const raw = resolveProvidersValue(environment);
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Protected allowed-model policy is invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Protected allowed-model policy is invalid.");
  }

  const models: string[] = [];
  for (const provider of parsed) {
    if (typeof provider !== "object" || provider === null) {
      throw new Error("Protected allowed-model policy is invalid.");
    }
    const declared = (provider as { allowed_models?: unknown }).allowed_models;
    if (
      !Array.isArray(declared) ||
      !declared.every((model) => typeof model === "string")
    ) {
      throw new Error("Protected allowed-model policy is invalid.");
    }
    models.push(...declared);
  }
  return models;
}

function parseCurrentPreferences(
  contents: string | undefined,
): Preferences | undefined {
  if (contents === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(contents);
    const result = PreferencesSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function mergePreferences(
  current: Preferences | undefined,
  requested: Preferences,
): Preferences {
  return PreferencesSchema.parse({
    schema_version: requested.schema_version,
    ...(current?.default_model === undefined
      ? {}
      : { default_model: current.default_model }),
    ...(requested.default_model === undefined
      ? {}
      : { default_model: requested.default_model }),
    ...(current?.steering_prompt === undefined &&
    requested.steering_prompt === undefined
      ? {}
      : {
          steering_prompt:
            requested.steering_prompt ?? current?.steering_prompt,
        }),
    ...(current?.result_verbosity === undefined &&
    requested.result_verbosity === undefined
      ? {}
      : {
          result_verbosity:
            requested.result_verbosity ?? current?.result_verbosity,
        }),
    ...(current?.enabled_features === undefined &&
    requested.enabled_features === undefined
      ? {}
      : {
          enabled_features:
            requested.enabled_features ?? current?.enabled_features,
        }),
    ...(current?.model_routing === undefined &&
    requested.model_routing === undefined
      ? {}
      : {
          model_routing: {
            ...current?.model_routing,
            ...requested.model_routing,
          },
        }),
    ...(current?.limits === undefined && requested.limits === undefined
      ? {}
      : { limits: { ...current?.limits, ...requested.limits } }),
  });
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) {
      return undefined;
    }
    throw new Error("Global preferences cannot be read.", { cause: error });
  }
}

function revision(contents: string | undefined): `sha256:${string}` {
  return hash(contents === undefined ? "<missing>" : contents);
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
