import {
  createSandbox,
  verifyPatchInSandbox,
  type CreateSandboxOptions,
  type RunSandboxProcessOptions,
  type Sandbox,
  type SandboxProcessRun,
  type VerificationCommand,
} from "../auto-validate/index.js";

import { parseLintOutput, parseTypeOutput } from "./parsers.js";
import type { LinterName, LintViolation } from "./contracts.js";

/**
 * Semantic verification for repair patches.
 *
 * A structurally valid diff is not the same as a diff that fixes anything.
 * `auto_validate_tests` has always closed that gap for tests by running them;
 * this closes it for lint and type fixes by re-running the real tool against
 * the patched copy and counting what is left.
 *
 * The tool receives a linter's *output*, never the command that produced it, so
 * the command is either supplied by the caller or inferred from the project.
 * When neither yields one, verification reports itself unavailable and the
 * caller still gets today's unverified patch — never a silent downgrade.
 */

export type VerificationSandboxFactory = (
  options: CreateSandboxOptions,
) => Promise<Sandbox>;

export type VerificationCommandRunner = (
  options: RunSandboxProcessOptions,
) => Promise<SandboxProcessRun>;

export type VerificationStatus =
  "verified" | "not_fixed" | "unavailable" | "apply_failed";

export interface FixVerification {
  readonly status: VerificationStatus;
  /** Violations reported in the caller's input. */
  readonly violations_before: number;
  /** Violations still reported after the patch, when a run happened. */
  readonly violations_after?: number;
  /** The command that was run, for reproducibility. */
  readonly command?: string;
  /** Why verification could not run, when it could not. */
  readonly reason?: string;
}

/** Commands that re-run a tool over the whole project in machine form. */
const LINT_COMMANDS: Readonly<Record<LinterName, VerificationCommand>> = {
  eslint: { command: "npx", args: ["eslint", "--format", "json", "."] },
  biome: { command: "npx", args: ["biome", "check", "--reporter=json", "."] },
  ruff: { command: "ruff", args: ["check", "--output-format", "json", "."] },
};

const TYPE_COMMANDS: Readonly<Record<string, VerificationCommand>> = {
  tsc: { command: "npx", args: ["tsc", "--noEmit"] },
  mypy: { command: "mypy", args: ["."] },
  pyright: { command: "npx", args: ["pyright", "--outputjson"] },
};

export function resolveLintVerificationCommand(
  linter: LinterName,
  explicit?: string,
): VerificationCommand | undefined {
  return explicit === undefined
    ? LINT_COMMANDS[linter]
    : splitCommandText(explicit);
}

export function resolveTypeVerificationCommand(
  checker: string,
  explicit?: string,
): VerificationCommand | undefined {
  return explicit === undefined
    ? TYPE_COMMANDS[checker]
    : splitCommandText(explicit);
}

export interface VerifyFixInput {
  readonly repositoryRoot: string;
  readonly patch: { readonly patch: string };
  readonly command: VerificationCommand | undefined;
  readonly violationsBefore: number;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
  /** Parses the re-run output back into violations. */
  readonly parse: (output: string) => readonly LintViolation[];
  readonly sandboxFactory?:
    ((options: CreateSandboxOptions) => Promise<Sandbox>) | undefined;
  readonly commandRunner?:
    | ((options: RunSandboxProcessOptions) => Promise<SandboxProcessRun>)
    | undefined;
}

/**
 * Applies the patch to a throwaway copy, re-runs the tool, and counts what
 * remains.
 *
 * Never throws for an expected outcome: an unavailable command, a rejected
 * patch, and a still-failing project are all results the caller reports.
 */
export async function verifyFix(
  input: VerifyFixInput,
): Promise<FixVerification> {
  if (input.command === undefined) {
    return {
      status: "unavailable",
      violations_before: input.violationsBefore,
      reason:
        "No verification command was supplied and none could be inferred for this tool.",
    };
  }

  const commandText = [input.command.command, ...input.command.args].join(" ");
  let sandbox: Sandbox;
  try {
    sandbox = await (input.sandboxFactory ?? createSandbox)({
      sourceRoot: input.repositoryRoot,
    });
  } catch {
    return {
      status: "unavailable",
      violations_before: input.violationsBefore,
      command: commandText,
      reason: "The repository could not be copied into an isolated sandbox.",
    };
  }

  try {
    const verification = await verifyPatchInSandbox({
      root: sandbox.root,
      patch: input.patch,
      command: input.command,
      timeout_ms: input.timeout_ms,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.commandRunner === undefined
        ? {}
        : { commandRunner: input.commandRunner }),
    });

    if (verification.status === "apply_failed") {
      return {
        status: "apply_failed",
        violations_before: input.violationsBefore,
        command: commandText,
        reason: verification.error,
      };
    }

    const run = verification.run;
    if (run.error !== null || run.timed_out) {
      return {
        status: "unavailable",
        violations_before: input.violationsBefore,
        command: commandText,
        reason: run.timed_out
          ? "The verification command exceeded its deadline."
          : (run.error ?? "The verification command could not be executed."),
      };
    }

    // Linters report findings on stdout and exit non-zero; a non-zero exit is
    // therefore not itself a failure to verify.
    let remaining: readonly LintViolation[];
    try {
      remaining = input.parse(`${run.stdout}\n${run.stderr}`.trim());
    } catch {
      return {
        status: "unavailable",
        violations_before: input.violationsBefore,
        command: commandText,
        reason: "The verification output could not be parsed.",
      };
    }

    return {
      status: remaining.length === 0 ? "verified" : "not_fixed",
      violations_before: input.violationsBefore,
      violations_after: remaining.length,
      command: commandText,
    };
  } finally {
    await sandbox.dispose().catch(() => undefined);
  }
}

/** Parses a re-run of a linter back into violations. */
export function lintOutputParser(
  linter: LinterName,
): (output: string) => readonly LintViolation[] {
  return (output) =>
    output.length === 0 ? [] : parseLintOutput(output, linter);
}

/**
 * Parses a re-run of a type checker back into violations.
 *
 * Accepts `"auto"` because the tool's own input does: the parser detects the
 * format, even though no command can be inferred for it.
 */
export function typeOutputParser(
  checker: "tsc" | "mypy" | "pyright" | "auto",
): (output: string) => readonly LintViolation[] {
  return (output) =>
    output.length === 0 ? [] : parseTypeOutput(output, checker);
}

/**
 * Splits a caller-supplied command into an argv pair.
 *
 * Deliberately whitespace-only: the command is spawned without a shell, so
 * quoting and expansion are neither honored nor needed.
 */
function splitCommandText(text: string): VerificationCommand | undefined {
  const tokens = text
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const [command, ...args] = tokens;
  return command === undefined ? undefined : { command, args };
}
