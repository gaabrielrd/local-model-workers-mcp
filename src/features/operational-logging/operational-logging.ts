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
    return path.join(
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
    environment.XDG_STATE_HOME ?? path.join(homeDirectory, ".local", "state");
  return path.join(
    stateHome,
    "local-model-workers-mcp",
    OPERATIONAL_LOG_DIRECTORY_NAME,
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
