import { applyValidatedPatch, PatchApplyError } from "./patch-apply.js";
import {
  runSandboxProcess,
  type RunSandboxProcessOptions,
  type SandboxProcessRun,
} from "./sandbox.js";

/**
 * Sandbox patch verification.
 *
 * `auto_validate_tests` established the pattern: apply a candidate patch to a
 * throwaway copy, run the real command, and judge the patch by what actually
 * happened. This module owns that step on its own so any tool producing a patch
 * can verify it, rather than only the test proposer.
 *
 * It deliberately knows nothing about tests, linters, or compilers — it takes a
 * patch and a command and reports what the command did.
 */

export interface VerificationCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Anything carrying a unified diff.
 *
 * Both `ValidatedTestPatch` and `ValidatedLintPatch` satisfy this structurally,
 * so verification does not have to depend on either feature's patch type.
 */
export interface DiffCarrier {
  readonly patch: string;
}

export type SandboxVerification =
  | { readonly status: "ran"; readonly run: SandboxProcessRun }
  | { readonly status: "apply_failed"; readonly error: string };

export interface VerifyPatchInSandboxInput {
  /** An existing sandbox root. Callers own its lifetime. */
  readonly root: string;
  readonly patch: DiffCarrier;
  readonly command: VerificationCommand;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
  /** Test seam. Production callers use the real sandbox runner. */
  readonly commandRunner?:
    | ((options: RunSandboxProcessOptions) => Promise<SandboxProcessRun>)
    | undefined;
  /**
   * Called once the patch applied cleanly, immediately before the command runs.
   * Never called when the patch is rejected, so a caller reporting progress
   * cannot announce a run that did not happen.
   */
  readonly onBeforeRun?: (() => void) | undefined;
}

/**
 * Applies `patch` inside `root` and runs `command` against the result.
 *
 * A patch that will not apply is reported as `apply_failed` rather than thrown:
 * for a caller iterating on model output, a rejected patch is an expected
 * outcome to feed back, not an exceptional condition.
 */
export async function verifyPatchInSandbox(
  input: VerifyPatchInSandboxInput,
): Promise<SandboxVerification> {
  try {
    await applyValidatedPatch({ root: input.root, patch: input.patch });
  } catch (error: unknown) {
    if (error instanceof PatchApplyError) {
      return { status: "apply_failed", error: error.message };
    }
    throw error;
  }

  input.onBeforeRun?.();

  const runner = input.commandRunner ?? runSandboxProcess;
  const run = await runner({
    command: input.command.command,
    args: [...input.command.args],
    cwd: input.root,
    timeout_ms: input.timeout_ms,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  return { status: "ran", run };
}
