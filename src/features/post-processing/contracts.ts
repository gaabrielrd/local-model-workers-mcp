import type { PostProcessingHook } from "../configuration/index.js";

export interface HookProcessRun {
  readonly exit_code: number | null;
  readonly signal_code: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timed_out: boolean;
  readonly error: string | null;
  readonly duration_ms: number;
}

export interface RunHookProcessOptions {
  readonly hook: PostProcessingHook;
  readonly cwd: string;
  readonly stdin: string;
  readonly signal?: AbortSignal;
}

export interface PostProcessingAdapters {
  runProcess(options: RunHookProcessOptions): Promise<HookProcessRun>;
  createTempDirectory(): Promise<string>;
  removeDirectory(directory: string): Promise<void>;
}

export type PostProcessingHookOutcome =
  | {
      readonly status: "passed";
      readonly patch: string;
      readonly executed: readonly string[];
    }
  | {
      readonly status: "blocked";
      readonly hook: string;
      readonly code: "hook_failed" | "hook_timed_out" | "hook_spawn_failed";
      readonly diagnostic: string;
      readonly executed: readonly string[];
    };

export interface ApplyPatchHooksOptions {
  readonly hooks: readonly PostProcessingHook[];
  readonly patch: string;
  readonly validate: (patch: string) => Promise<string> | string;
  readonly signal?: AbortSignal;
}

export interface PostProcessingService {
  applyPatchHooks(
    options: ApplyPatchHooksOptions,
  ): Promise<PostProcessingHookOutcome>;
}
