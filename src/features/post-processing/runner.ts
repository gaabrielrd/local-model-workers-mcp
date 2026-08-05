import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  POST_PROCESSING_HOOK_CAPTURE_BYTES,
  POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT,
  type PostProcessingHook,
} from "../configuration/index.js";

import type {
  ApplyPatchHooksOptions,
  HookProcessRun,
  PostProcessingAdapters,
  PostProcessingHookOutcome,
  PostProcessingService,
  RunHookProcessOptions,
} from "./contracts.js";

const HOOK_TEMP_DIRECTORY_PREFIX = "lmw-hook-";

const WINDOWS_COMMAND_SHIMS = new Map([
  ["npm", "npm.cmd"],
  ["npx", "npx.cmd"],
]);

export interface CreatePostProcessingRunnerOptions {
  readonly adapters?: PostProcessingAdapters;
}

export function createPostProcessingRunner(
  options: CreatePostProcessingRunnerOptions = {},
): PostProcessingService {
  const adapters = options.adapters ?? nodeAdapters;
  return {
    async applyPatchHooks(
      applyOptions: ApplyPatchHooksOptions,
    ): Promise<PostProcessingHookOutcome> {
      if (applyOptions.hooks.length === 0) {
        return { status: "passed", patch: applyOptions.patch, executed: [] };
      }
      const temporaryDirectory = await adapters.createTempDirectory();
      try {
        let current = applyOptions.patch;
        const executed: string[] = [];
        for (const hook of applyOptions.hooks) {
          const label = hookLabel(hook);
          const run = await adapters.runProcess({
            hook,
            cwd: temporaryDirectory,
            stdin: current,
            ...(applyOptions.signal === undefined
              ? {}
              : { signal: applyOptions.signal }),
          });
          executed.push(label);
          if (run.timed_out) {
            return blockedOutcome(
              label,
              "hook_timed_out",
              `The hook timed out after ${
                hook.timeout_ms ?? POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT
              }ms.`,
              executed,
            );
          }
          if (run.error !== null) {
            return blockedOutcome(
              label,
              "hook_spawn_failed",
              `The hook could not be started: ${run.error}`,
              executed,
            );
          }
          if (run.exit_code !== 0) {
            return blockedOutcome(
              label,
              "hook_failed",
              `The hook exited with code ${run.exit_code}.${stderrSuffix(
                run.stderr,
              )}`,
              executed,
            );
          }
          const transformed = run.stdout;
          if (transformed.trim().length > 0 && transformed !== current) {
            try {
              current = await applyOptions.validate(transformed);
            } catch (error: unknown) {
              return blockedOutcome(
                label,
                "hook_failed",
                `The hook output was rejected by the local patch policy: ${errorMessage(
                  error,
                )}`,
                executed,
              );
            }
          }
        }
        return { status: "passed", patch: current, executed };
      } finally {
        await adapters
          .removeDirectory(temporaryDirectory)
          .catch(() => undefined);
      }
    },
  };
}

const nodeAdapters: PostProcessingAdapters = {
  runProcess: (options) => runHookProcess(options),
  createTempDirectory: () =>
    mkdtemp(path.join(os.tmpdir(), HOOK_TEMP_DIRECTORY_PREFIX)),
  removeDirectory: (directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 }),
};

function runHookProcess(
  options: RunHookProcessOptions,
): Promise<HookProcessRun> {
  return new Promise<HookProcessRun>((resolve, reject) => {
    const startedAt = Date.now();
    const command = resolvedCommand(options.hook.command);
    const child = spawn(command, [...(options.hook.args ?? [])], {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdin.on("error", () => {
      // The hook may close its stdin early; delivery is best-effort.
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = capture(stderr, chunk);
    });

    const timeoutMs =
      options.hook.timeout_ms ?? POST_PROCESSING_HOOK_TIMEOUT_MS_DEFAULT;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const rejectAborted = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        new DOMException("The post-processing task was aborted.", "AbortError"),
      );
    };
    const onAbort = (): void => {
      terminate(child);
      rejectAborted();
    };
    if (options.signal?.aborted === true) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdin.write(options.stdin);
    child.stdin.end();

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exit_code: null,
        signal_code: null,
        stdout,
        stderr,
        timed_out: false,
        error: error.message,
        duration_ms: Date.now() - startedAt,
      });
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exit_code: timedOut ? null : code,
        signal_code: timedOut ? null : (signal ?? null),
        stdout,
        stderr,
        timed_out: timedOut,
        error: null,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}

function capture(current: string, chunk: Buffer): string {
  const remaining = POST_PROCESSING_HOOK_CAPTURE_BYTES - current.length;
  if (remaining <= 0) {
    return current;
  }
  return current + chunk.toString("utf8").slice(0, remaining);
}

function resolvedCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  return WINDOWS_COMMAND_SHIMS.get(command) ?? command;
}

function hookLabel(hook: PostProcessingHook): string {
  return [hook.command, ...(hook.args ?? [])].join(" ");
}

function stderrSuffix(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return ` ${trimmed.slice(0, 500)}`;
}

function blockedOutcome(
  hook: string,
  code: "hook_failed" | "hook_timed_out" | "hook_spawn_failed",
  diagnostic: string,
  executed: readonly string[],
): PostProcessingHookOutcome {
  return { status: "blocked", hook, code, diagnostic, executed };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function terminate(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to terminating only the direct child.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The child already exited.
  }
}
