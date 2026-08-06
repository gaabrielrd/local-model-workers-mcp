import {
  migrateLegacyProviders,
  hasLegacyProviderVariables,
} from "../configuration/index.js";

/**
 * Provider seeding for `setup`.
 *
 * The server reads `LMW_PROVIDERS` and nothing else. Setup is the one place
 * that still looks at the retired single-provider variables, so an existing
 * installation is carried forward instead of silently losing its endpoint.
 *
 * Precedence is deliberate: an already-migrated `LMW_PROVIDERS` wins over the
 * legacy variables, so re-running setup on a migrated machine never regresses
 * to a stale endpoint that happens to linger in a shell profile.
 */

/**
 * The provider contract in force, migrating the retired variables when needed.
 *
 * One resolver so every entry point in `installation` — setup, harness files,
 * preference validation — sees the same providers on a not-yet-migrated
 * machine. Returns `undefined` when nothing is configured at all.
 */
export function resolveProvidersValue(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const explicit = environment.LMW_PROVIDERS?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  return migrateLegacyProviders(environment);
}

export interface ProviderSeed {
  readonly baseUrl: string;
  readonly bearerToken?: string;
  readonly allowedModels?: readonly string[];
  /** True when the values came from the retired variables. */
  readonly migratedFromLegacy: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:1234/v1";

/** Reads the current provider settings to prefill the setup prompts. */
export function readProviderSeed(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderSeed {
  const fromProviders = seedFromProviders(environment);
  if (fromProviders !== undefined) {
    return fromProviders;
  }

  const migrated = migrateLegacyProviders(environment);
  if (migrated !== undefined) {
    const seed = seedFromProvidersValue(migrated);
    if (seed !== undefined) {
      return { ...seed, migratedFromLegacy: true };
    }
  }

  return {
    baseUrl: DEFAULT_BASE_URL,
    migratedFromLegacy: hasLegacyProviderVariables(environment),
  };
}

/**
 * Builds the `LMW_PROVIDERS` value setup writes out.
 *
 * A single entry: setup configures one endpoint. Multi-provider setups are
 * authored by hand and are preserved because `readProviderSeed` prefers an
 * existing `LMW_PROVIDERS`.
 */
export function buildProvidersValue(input: {
  readonly baseUrl: string;
  readonly bearerToken?: string | undefined;
  readonly allowedModels: readonly string[];
  /** Written out only when it differs from the default for the host. */
  readonly tlsVerify?: boolean | undefined;
}): string {
  return JSON.stringify([
    {
      name: "lm-studio",
      type: "lm-studio",
      base_url: input.baseUrl,
      ...(input.bearerToken === undefined || input.bearerToken.length === 0
        ? {}
        : { bearer_token: input.bearerToken }),
      allowed_models:
        input.allowedModels.length === 0 ? ["*"] : [...input.allowedModels],
      priority: 0,
      ...(input.tlsVerify === undefined ? {} : { tls_verify: input.tlsVerify }),
    },
  ]);
}

/**
 * Whether setup must write an explicit `tls_verify: false` for this endpoint.
 *
 * A remote provider now verifies certificates unless told otherwise, so a
 * plain-HTTP LAN endpoint that worked before 3.0 would be refused at startup.
 * Setup records the opt-out the user implicitly chose by entering that URL, and
 * says so — an install that already worked must not break silently, and the
 * decision must be visible in the written configuration rather than assumed.
 */
export function needsPlainHttpOptOut(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  return url.protocol === "http:" && !isLoopback(url.hostname);
}

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function seedFromProviders(
  environment: Readonly<Record<string, string | undefined>>,
): ProviderSeed | undefined {
  const raw = environment.LMW_PROVIDERS?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const seed = seedFromProvidersValue(raw);
  return seed === undefined
    ? undefined
    : { ...seed, migratedFromLegacy: false };
}

/** Reads the highest-priority entry, which is the one setup edits. */
function seedFromProvidersValue(
  raw: string,
): Omit<ProviderSeed, "migratedFromLegacy"> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return undefined;
  }

  const entries = parsed.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
  const primary = [...entries].sort(
    (left, right) => priorityOf(left) - priorityOf(right),
  )[0];
  if (primary === undefined || typeof primary.base_url !== "string") {
    return undefined;
  }

  const bearerToken =
    typeof primary.bearer_token === "string" ? primary.bearer_token : undefined;
  const allowedModels = Array.isArray(primary.allowed_models)
    ? primary.allowed_models.filter(
        (model): model is string => typeof model === "string",
      )
    : undefined;

  return {
    baseUrl: primary.base_url,
    ...(bearerToken === undefined ? {} : { bearerToken }),
    ...(allowedModels === undefined ? {} : { allowedModels }),
  };
}

function priorityOf(entry: Record<string, unknown>): number {
  return typeof entry.priority === "number"
    ? entry.priority
    : Number.MAX_SAFE_INTEGER;
}
