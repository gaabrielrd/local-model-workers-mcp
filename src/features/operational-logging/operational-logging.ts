import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  ErrorCodeSchema,
  TerminalStatusSchema,
  type TaskTerminalMetadata,
} from "../task-execution/index.js";

export const OPERATIONAL_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const OPERATIONAL_LOG_DIRECTORY_NAME = "logs";

/**
 * Raw events are pruned after seven days, but the week/month/lifetime windows
 * must outlive that. Daily counters are therefore rolled up into a durable
 * summary that survives pruning. The rollup holds only numbers, status names,
 * error codes, and provider names — never repository content.
 */
const DEFAULT_PROMPT_TOKENS = 2_500;
const DEFAULT_COMPLETION_TOKENS = 500;

export const OPERATIONAL_ROLLUP_FILENAME = "rollup.json";
export const OPERATIONAL_ROLLUP_RETENTION_DAYS = 400;

interface RollupDay {
  tokens_saved: number;
  queries_offloaded: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tasks: number;
  failed_tasks: number;
  timed_out_tasks: number;
  cancelled_tasks: number;
  retries: number;
  by_error_code: Record<string, number>;
  by_provider: Record<string, number>;
  by_task_model: Record<string, TaskModelCounters>;
}

/**
 * Per-`(task_type, model)` counters backing adaptive routing.
 *
 * Counters only, in keeping with the rollup discipline: no prompts, no outputs,
 * no repository content.
 */
interface TaskModelCounters {
  attempts: number;
  completed: number;
  /** Failures the model is answerable for: bad output, blown budgets. */
  model_faults: number;
  /** Patches the model produced that policy refused. */
  patch_rejections: number;
  duration_ms_total: number;
}

/**
 * Error codes a model is answerable for.
 *
 * Deliberately narrow. A provider outage (`model_unavailable`), a bad request,
 * or a cancelled task says nothing about the model's quality — counting those
 * would route away from a perfectly good model every time the server was down.
 */
const MODEL_FAULT_CODES = new Set([
  "inference_failed",
  "context_limit_exceeded",
  "interaction_limit_exceeded",
]);

const PATCH_REJECTION_CODES = new Set([
  "patch_not_allowed",
  "patch_limit_exceeded",
]);

function emptyTaskModelCounters(): TaskModelCounters {
  return {
    attempts: 0,
    completed: 0,
    model_faults: 0,
    patch_rejections: 0,
    duration_ms_total: 0,
  };
}

/** Composite key; `::` cannot occur in a validated identifier. */
function taskModelKey(taskType: string, model: string): string {
  return `${taskType}::${model}`;
}

interface RollupDocument {
  schema_version: 1;
  days: Record<string, RollupDay>;
}

function emptyRollupDay(): RollupDay {
  return {
    tokens_saved: 0,
    queries_offloaded: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tasks: 0,
    failed_tasks: 0,
    timed_out_tasks: 0,
    cancelled_tasks: 0,
    retries: 0,
    by_error_code: {},
    by_provider: {},
    by_task_model: {},
  };
}

function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Reads the durable daily rollup. A missing or corrupt rollup restarts
 * accumulation rather than failing the caller — observability never breaks work.
 */
async function readRollupDocument(directory: string): Promise<RollupDocument> {
  try {
    const raw = await readFile(
      path.join(directory, OPERATIONAL_ROLLUP_FILENAME),
      "utf8",
    );
    const parsed = JSON.parse(raw) as RollupDocument;
    if (parsed.schema_version !== 1 || typeof parsed.days !== "object") {
      return { schema_version: 1, days: {} };
    }
    // A rollup written before per-(task_type, model) scoring existed has no
    // by_task_model map. Backfill it rather than losing the whole history.
    for (const day of Object.values(parsed.days)) {
      day.by_task_model ??= {};
    }
    return parsed;
  } catch {
    return { schema_version: 1, days: {} };
  }
}

const SafeIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/u);

export const OperationalEventSchema = z
  .object({
    task_id: SafeIdentifierSchema,
    task_type: SafeIdentifierSchema.optional(),
    started_at_ms: z.number().int().nonnegative(),
    ended_at_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    model: SafeIdentifierSchema,
    status: TerminalStatusSchema,
    error_code: ErrorCodeSchema.nullable(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    estimated_tokens_saved: z.number().int().nonnegative().optional(),
    provider: SafeIdentifierSchema.optional(),
    retry_count: z.number().int().nonnegative().max(1_000).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.ended_at_ms < event.started_at_ms) {
      context.addIssue({
        code: "custom",
        message: "ended_at_ms precedes started_at_ms",
      });
    }
    if (event.duration_ms !== event.ended_at_ms - event.started_at_ms) {
      context.addIssue({
        code: "custom",
        message: "duration_ms does not match timestamps",
      });
    }
    if ((event.status === "completed") !== (event.error_code === null)) {
      context.addIssue({
        code: "custom",
        message: "error_code does not match status",
      });
    }
  });

export type OperationalEvent = z.infer<typeof OperationalEventSchema>;

export const GetOffloadStatsInputSchema = z
  .object({
    period: z.enum(["week", "month", "lifetime", "all"]).default("all"),
    log_directory: z.string().optional(),
  })
  .strict();

export type GetOffloadStatsInput = z.infer<typeof GetOffloadStatsInputSchema>;

export interface OffloadStatsPeriod {
  readonly tokens_saved: number;
  readonly queries_offloaded: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
}

/** Failure and retry counters for one time window. Metadata only. */
export interface ReliabilityPeriod {
  readonly total_tasks: number;
  readonly failed_tasks: number;
  readonly timed_out_tasks: number;
  readonly cancelled_tasks: number;
  readonly retries: number;
  /** Failed + timed out, over total. 0 when the window is empty. */
  readonly error_rate: number;
  /** Failure counts keyed by the logged error code. */
  readonly by_error_code: Readonly<Record<string, number>>;
  /** Failure counts keyed by provider, or "unknown" when unattributed. */
  readonly by_provider: Readonly<Record<string, number>>;
}

/** Live breaker and health state for one provider. */
export interface ProviderReliabilityState {
  readonly name: string;
  readonly status: string;
  readonly circuit_state: string;
  readonly last_checked_at: string | null;
  readonly error_code?: string;
}

export interface ReliabilityStats {
  readonly weekly: ReliabilityPeriod;
  readonly monthly: ReliabilityPeriod;
  readonly lifetime: ReliabilityPeriod;
  readonly providers: readonly ProviderReliabilityState[];
}

export interface OffloadStatsResult {
  readonly weekly: OffloadStatsPeriod;
  readonly monthly: OffloadStatsPeriod;
  readonly lifetime: OffloadStatsPeriod;
  readonly query_count: number;
  readonly summary: string;
  /** Additive: existing fields and their shapes are unchanged. */
  readonly reliability: ReliabilityStats;
}

export interface OperationalEventRecorder {
  record(event: TaskTerminalMetadata): Promise<void>;
}

export interface OperationalLogStore extends OperationalEventRecorder {
  cleanup(): Promise<number>;
}

export interface CreateOperationalLogStoreOptions {
  readonly directory: string;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export function createOperationalLogStore(
  options: CreateOperationalLogStoreOptions,
): OperationalLogStore {
  const directory = path.resolve(options.directory);
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;

  async function cleanup(): Promise<number> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const cutoff = now() - OPERATIONAL_LOG_RETENTION_MS;
    const entries = await readdir(directory, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = /^event-(\d{1,16})-[a-zA-Z0-9-]{1,64}\.json$/u.exec(
        entry.name,
      );
      const occurredAt =
        match?.[1] === undefined ? undefined : Number(match[1]);
      if (
        occurredAt === undefined ||
        !Number.isSafeInteger(occurredAt) ||
        occurredAt >= cutoff
      ) {
        continue;
      }
      await unlink(path.join(directory, entry.name));
      removed += 1;
    }
    return removed;
  }

  async function readRollup(): Promise<RollupDocument> {
    return readRollupDocument(directory);
  }

  async function updateRollup(parsed: OperationalEvent): Promise<void> {
    const rollup = await readRollup();
    const key = dayKey(parsed.ended_at_ms);
    const day = rollup.days[key] ?? emptyRollupDay();

    const prompt = parsed.prompt_tokens ?? DEFAULT_PROMPT_TOKENS;
    const completion = parsed.completion_tokens ?? DEFAULT_COMPLETION_TOKENS;

    day.total_tasks += 1;
    day.retries += parsed.retry_count ?? 0;

    if (parsed.status === "completed") {
      day.tokens_saved += parsed.estimated_tokens_saved ?? prompt + completion;
      day.queries_offloaded += 1;
      day.prompt_tokens += prompt;
      day.completion_tokens += completion;
    } else if (parsed.status === "failed") {
      day.failed_tasks += 1;
    } else if (parsed.status === "timed_out") {
      day.timed_out_tasks += 1;
    } else if (parsed.status === "cancelled") {
      day.cancelled_tasks += 1;
    }

    if (parsed.status === "failed" || parsed.status === "timed_out") {
      const code = parsed.error_code ?? "unspecified";
      day.by_error_code[code] = (day.by_error_code[code] ?? 0) + 1;
      const provider = parsed.provider ?? "unknown";
      day.by_provider[provider] = (day.by_provider[provider] ?? 0) + 1;
    }

    // Scoring is per routing slot, so an event without one is not scoreable.
    if (parsed.task_type !== undefined) {
      const key = taskModelKey(parsed.task_type, parsed.model);
      const counters = day.by_task_model[key] ?? emptyTaskModelCounters();
      counters.attempts += 1;
      counters.duration_ms_total += parsed.duration_ms;
      if (parsed.status === "completed") {
        counters.completed += 1;
      } else if (parsed.error_code !== null) {
        if (MODEL_FAULT_CODES.has(parsed.error_code)) {
          counters.model_faults += 1;
        } else if (PATCH_REJECTION_CODES.has(parsed.error_code)) {
          counters.patch_rejections += 1;
        }
      }
      day.by_task_model[key] = counters;
    }

    rollup.days[key] = day;

    const horizon = dayKey(
      now() - OPERATIONAL_ROLLUP_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    for (const existing of Object.keys(rollup.days)) {
      if (existing < horizon) {
        delete rollup.days[existing];
      }
    }

    await writeFile(
      path.join(directory, OPERATIONAL_ROLLUP_FILENAME),
      `${JSON.stringify(rollup)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  async function record(event: TaskTerminalMetadata): Promise<void> {
    const parsed = OperationalEventSchema.parse(event);
    const id = createId();
    if (!/^[a-zA-Z0-9-]{1,64}$/u.test(id)) {
      throw new Error("The operational event identifier is invalid.");
    }
    await cleanup();
    await updateRollup(parsed);
    const filename = `event-${parsed.ended_at_ms}-${id}.json`;
    await writeFile(
      path.join(directory, filename),
      `${JSON.stringify(parsed)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
  }

  return Object.freeze({ cleanup, record });
}

export async function inspectOperationalLogs(
  directory: string,
): Promise<readonly OperationalEvent[]> {
  const resolved = path.resolve(directory);
  let entries;
  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch (error: unknown) {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  }
  const events: OperationalEvent[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      !entry.isFile() ||
      !/^event-\d{1,16}-[a-zA-Z0-9-]{1,64}\.json$/u.test(entry.name)
    ) {
      continue;
    }
    try {
      events.push(
        OperationalEventSchema.parse(
          JSON.parse(await readFile(path.join(resolved, entry.name), "utf8")),
        ),
      );
    } catch {
      // Inspection ignores malformed records without exposing their content.
    }
  }
  return events;
}

export function resolveOperationalLogDirectory(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (platform === "darwin") {
    return path.posix.join(
      homeDirectory,
      "Library",
      "Logs",
      "local-model-workers-mcp",
    );
  }
  if (platform === "win32") {
    const base =
      environment.LOCALAPPDATA ??
      path.win32.join(homeDirectory, "AppData", "Local");
    return path.win32.join(
      base,
      "local-model-workers-mcp",
      OPERATIONAL_LOG_DIRECTORY_NAME,
    );
  }
  const stateHome =
    environment.XDG_STATE_HOME ??
    path.posix.join(homeDirectory, ".local", "state");
  return path.posix.join(
    stateHome,
    "local-model-workers-mcp",
    OPERATIONAL_LOG_DIRECTORY_NAME,
  );
}

export interface GetOffloadStatsOptions {
  /**
   * Live provider health and breaker state. Supplied by the server so the
   * report shows current degradation, not just history.
   */
  readonly providers?: readonly ProviderReliabilityState[];
}

export async function getOffloadStats(
  directory: string,
  nowMs: number = Date.now(),
  options: GetOffloadStatsOptions = {},
): Promise<OffloadStatsResult> {
  const events = await inspectOperationalLogs(directory);
  const weekCutoff = nowMs - 7 * 24 * 60 * 60 * 1_000;
  const monthCutoff = nowMs - 30 * 24 * 60 * 60 * 1_000;

  let weekly: OffloadStatsPeriod = {
    tokens_saved: 0,
    queries_offloaded: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  };
  let monthly: OffloadStatsPeriod = {
    tokens_saved: 0,
    queries_offloaded: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  };
  let lifetime: OffloadStatsPeriod = {
    tokens_saved: 0,
    queries_offloaded: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
  };

  for (const event of events) {
    if (event.status !== "completed") continue;

    const prompt = event.prompt_tokens ?? 2_500;
    const completion = event.completion_tokens ?? 500;
    const tokensSaved = event.estimated_tokens_saved ?? prompt + completion;

    lifetime = {
      tokens_saved: lifetime.tokens_saved + tokensSaved,
      queries_offloaded: lifetime.queries_offloaded + 1,
      prompt_tokens: lifetime.prompt_tokens + prompt,
      completion_tokens: lifetime.completion_tokens + completion,
    };

    if (event.ended_at_ms >= monthCutoff) {
      monthly = {
        tokens_saved: monthly.tokens_saved + tokensSaved,
        queries_offloaded: monthly.queries_offloaded + 1,
        prompt_tokens: monthly.prompt_tokens + prompt,
        completion_tokens: monthly.completion_tokens + completion,
      };
    }

    if (event.ended_at_ms >= weekCutoff) {
      weekly = {
        tokens_saved: weekly.tokens_saved + tokensSaved,
        queries_offloaded: weekly.queries_offloaded + 1,
        prompt_tokens: weekly.prompt_tokens + prompt,
        completion_tokens: weekly.completion_tokens + completion,
      };
    }
  }

  const reliability = await reliabilityForReport(
    directory,
    events,
    weekCutoff,
    monthCutoff,
    options.providers ?? [],
  );

  return {
    weekly,
    monthly,
    lifetime,
    query_count: lifetime.queries_offloaded,
    summary: `Token offload statistics: ${weekly.tokens_saved.toLocaleString()} tokens saved this week, ${monthly.tokens_saved.toLocaleString()} tokens saved this month, ${lifetime.tokens_saved.toLocaleString()} total tokens offloaded over time across ${lifetime.queries_offloaded} queries.`,
    reliability,
  };
}

/**
 * Builds the reliability section.
 *
 * The durable rollup outlives the seven-day raw-event pruning, so windows are
 * summed from it whenever it exists. Logs written before the rollup feature
 * fall back to the raw events that are still on disk.
 */
async function reliabilityForReport(
  directory: string,
  events: readonly OperationalEvent[],
  weekCutoff: number,
  monthCutoff: number,
  providers: readonly ProviderReliabilityState[],
): Promise<ReliabilityStats> {
  const rollup = await readRollupDocument(directory);
  const hasRollupData = Object.keys(rollup.days).length > 0;
  if (hasRollupData) {
    const weeklyKey = dayKey(weekCutoff);
    const monthlyKey = dayKey(monthCutoff);
    return {
      weekly: summarizeReliabilityRollup(rollup.days, weeklyKey),
      monthly: summarizeReliabilityRollup(rollup.days, monthlyKey),
      lifetime: summarizeReliabilityRollup(rollup.days, ""),
      providers,
    };
  }
  return {
    weekly: summarizeReliability(events, weekCutoff),
    monthly: summarizeReliability(events, monthCutoff),
    lifetime: summarizeReliability(events, Number.NEGATIVE_INFINITY),
    providers,
  };
}

/** Sums the daily rollup counters from the given day key onward. */
function summarizeReliabilityRollup(
  days: Readonly<Record<string, RollupDay>>,
  cutoffKey: string,
): ReliabilityPeriod {
  let total = 0;
  let failed = 0;
  let timedOut = 0;
  let cancelled = 0;
  let retries = 0;
  const byErrorCode: Record<string, number> = {};
  const byProvider: Record<string, number> = {};

  for (const [key, day] of Object.entries(days)) {
    if (key < cutoffKey) {
      continue;
    }
    total += day.total_tasks;
    failed += day.failed_tasks;
    timedOut += day.timed_out_tasks;
    cancelled += day.cancelled_tasks;
    retries += day.retries;
    for (const [code, count] of Object.entries(day.by_error_code)) {
      byErrorCode[code] = (byErrorCode[code] ?? 0) + count;
    }
    for (const [provider, count] of Object.entries(day.by_provider)) {
      byProvider[provider] = (byProvider[provider] ?? 0) + count;
    }
  }

  return {
    total_tasks: total,
    failed_tasks: failed,
    timed_out_tasks: timedOut,
    cancelled_tasks: cancelled,
    retries,
    error_rate:
      total === 0
        ? 0
        : Math.round(((failed + timedOut) / total) * 1_000) / 1_000,
    by_error_code: byErrorCode,
    by_provider: byProvider,
  };
}

/**
 * Aggregates terminal outcomes into failure and retry counters.
 *
 * Only allowlisted metadata is read — status, error code, provider name, and
 * retry count — so no repository content or credential can reach the report.
 */
function summarizeReliability(
  events: readonly OperationalEvent[],
  cutoffMs: number,
): ReliabilityPeriod {
  let total = 0;
  let failed = 0;
  let timedOut = 0;
  let cancelled = 0;
  let retries = 0;
  const byErrorCode: Record<string, number> = {};
  const byProvider: Record<string, number> = {};

  for (const event of events) {
    if (event.ended_at_ms < cutoffMs) {
      continue;
    }
    total += 1;
    retries += event.retry_count ?? 0;

    const isFailure = event.status === "failed" || event.status === "timed_out";
    if (event.status === "failed") {
      failed += 1;
    } else if (event.status === "timed_out") {
      timedOut += 1;
    } else if (event.status === "cancelled") {
      cancelled += 1;
    }

    if (isFailure) {
      const code = event.error_code ?? "unspecified";
      byErrorCode[code] = (byErrorCode[code] ?? 0) + 1;
      const provider = event.provider ?? "unknown";
      byProvider[provider] = (byProvider[provider] ?? 0) + 1;
    }
  }

  return {
    total_tasks: total,
    failed_tasks: failed,
    timed_out_tasks: timedOut,
    cancelled_tasks: cancelled,
    retries,
    error_rate:
      total === 0
        ? 0
        : Math.round(((failed + timedOut) / total) * 1_000) / 1_000,
    by_error_code: byErrorCode,
    by_provider: byProvider,
  };
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

/**
 * One model's record for one routing slot, over the retained rollup window.
 *
 * Rates are reported alongside `attempts` on purpose: 1 of 1 and 90 of 100 are
 * both "0.9-ish" to a ratio and nothing alike to a decision.
 */
export interface RoutingScore {
  readonly task_type: string;
  readonly model: string;
  readonly attempts: number;
  readonly completion_rate: number;
  readonly model_fault_rate: number;
  readonly patch_rejection_rate: number;
  readonly mean_duration_ms: number;
}

export type RoutingScoreSnapshot = readonly RoutingScore[];

/**
 * Reads per-`(task_type, model)` outcomes out of the durable rollup.
 *
 * Returns an empty snapshot when nothing has been recorded, which callers must
 * treat as "no basis to adapt" rather than "every model is bad".
 */
export async function readRoutingScores(
  directory: string,
): Promise<RoutingScoreSnapshot> {
  const rollup = await readRollupDocument(directory);
  const totals = new Map<string, TaskModelCounters>();

  for (const day of Object.values(rollup.days)) {
    for (const [key, counters] of Object.entries(day.by_task_model ?? {})) {
      const running = totals.get(key) ?? emptyTaskModelCounters();
      running.attempts += counters.attempts;
      running.completed += counters.completed;
      running.model_faults += counters.model_faults;
      running.patch_rejections += counters.patch_rejections;
      running.duration_ms_total += counters.duration_ms_total;
      totals.set(key, running);
    }
  }

  const scores: RoutingScore[] = [];
  for (const [key, counters] of totals) {
    const separator = key.indexOf("::");
    if (separator <= 0 || counters.attempts === 0) {
      continue;
    }
    scores.push({
      task_type: key.slice(0, separator),
      model: key.slice(separator + 2),
      attempts: counters.attempts,
      completion_rate: counters.completed / counters.attempts,
      model_fault_rate: counters.model_faults / counters.attempts,
      patch_rejection_rate: counters.patch_rejections / counters.attempts,
      mean_duration_ms: Math.round(
        counters.duration_ms_total / counters.attempts,
      ),
    });
  }
  return Object.freeze(scores);
}
