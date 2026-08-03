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

const SafeIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/u);

export const OperationalEventSchema = z
  .object({
    task_id: SafeIdentifierSchema,
    started_at_ms: z.number().int().nonnegative(),
    ended_at_ms: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    model: SafeIdentifierSchema,
    status: TerminalStatusSchema,
    error_code: ErrorCodeSchema.nullable(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    estimated_tokens_saved: z.number().int().nonnegative().optional(),
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

export interface OffloadStatsResult {
  readonly weekly: OffloadStatsPeriod;
  readonly monthly: OffloadStatsPeriod;
  readonly lifetime: OffloadStatsPeriod;
  readonly query_count: number;
  readonly summary: string;
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

  async function record(event: TaskTerminalMetadata): Promise<void> {
    const parsed = OperationalEventSchema.parse(event);
    const id = createId();
    if (!/^[a-zA-Z0-9-]{1,64}$/u.test(id)) {
      throw new Error("The operational event identifier is invalid.");
    }
    await cleanup();
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

export async function getOffloadStats(
  directory: string,
  nowMs: number = Date.now(),
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

  return {
    weekly,
    monthly,
    lifetime,
    query_count: lifetime.queries_offloaded,
    summary: `Token offload statistics: ${weekly.tokens_saved.toLocaleString()} tokens saved this week, ${monthly.tokens_saved.toLocaleString()} tokens saved this month, ${lifetime.tokens_saved.toLocaleString()} total tokens offloaded over time across ${lifetime.queries_offloaded} queries.`,
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
