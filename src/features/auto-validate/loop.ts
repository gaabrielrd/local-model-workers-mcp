import { z } from "zod";

import {
  resolveModelForTask,
  type EffectiveConfiguration,
} from "../configuration/index.js";
import {
  composeSystemProtocol,
  composeUntrustedPrompt,
  type ModelInferencePort,
} from "../model-inference/index.js";
import {
  createRepositoryReadCapability,
  type CreateRepositoryReadCapabilityInput,
  type RepositoryReadCapability,
} from "../repository-exploration/index.js";
import {
  createDiagnostic,
  createTaskRuntime,
  runTaskWithCapacity,
  type Diagnostic,
  type Limitation,
  type RequestLanguage,
  type TaskCapacityCoordinator,
  type TaskExecutionContext,
  type TaskProgressEvent,
  type TaskResponse,
  type TaskTerminalMetadata,
  type TaskWorkOutcome,
} from "../task-execution/index.js";
import {
  detectTestInfrastructure,
  PatchPolicyError,
  validateTestPatch,
  type ValidatedTestPatch,
} from "../test-proposal/index.js";
import {
  AutoValidateAttemptSchema,
  AutoValidateInputSchema,
  AutoValidateResultSchema,
  type AutoValidateAttempt,
  type AutoValidateProgressEvent,
  type AutoValidateResult,
  type CoverageDelta,
  type TestRunSummary,
} from "./contracts.js";
import { measureCoverage, type CoverageMeasurement } from "./coverage.js";
import { applyValidatedPatch, PatchApplyError } from "./patch-apply.js";
import {
  createSandbox,
  detectTestCommand,
  runSandboxProcess,
  splitCommand,
  type CreateSandboxOptions,
  type DetectedTestCommand,
  type RunSandboxProcessOptions,
  type Sandbox,
  type SandboxProcessRun,
} from "./sandbox.js";

const BoundedTextSchema = z.string().trim().min(1).max(8_000);
const BoundedPathSchema = z.string().trim().min(1).max(4_096);

const AutoValidateProposalSchema = z
  .object({
    patch: z
      .string()
      .min(1)
      .max(2 * 1_024 * 1_024),
    test_summary: BoundedTextSchema,
    affected_files: z.array(BoundedPathSchema).min(1).max(10),
    unresolved_conflicts: z.array(BoundedTextSchema).max(100),
    suggested_commands: z.array(z.string().trim().min(1).max(1_000)).max(20),
  })
  .strict();

type AutoValidateProposal = z.infer<typeof AutoValidateProposalSchema>;

const systemProtocol = composeSystemProtocol([
  "Propose tests only as one unified git diff.",
  "Change only tests, fixtures, mocks, or configuration exclusively used by tests.",
  "Do not rename or delete files and do not change production code.",
  "Derive behavior from the user goal, project structure, existing test conventions, then previous failure output.",
  "Fix the reported failures exactly; do not weaken assertions to force a green run.",
  "List unresolved conflicts instead of inventing product requirements.",
]);

export interface AutoValidateTestsInput {
  readonly request: unknown;
  readonly configuration: EffectiveConfiguration;
  readonly inference: ModelInferencePort;
  readonly coordinator: TaskCapacityCoordinator;
  readonly language: RequestLanguage;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: TaskProgressEvent) => void;
  readonly onIterationProgress?: (event: AutoValidateProgressEvent) => void;
  readonly createTaskId?: () => string;
  readonly onTerminal?: (event: TaskTerminalMetadata) => void | Promise<void>;
  readonly capabilityFactory?: (
    input: CreateRepositoryReadCapabilityInput,
  ) => Promise<RepositoryReadCapability>;
  readonly sandboxFactory?: (options: CreateSandboxOptions) => Promise<Sandbox>;
  readonly commandDetector?: (
    root: string,
  ) => Promise<DetectedTestCommand | undefined>;
  readonly commandRunner?: (
    options: RunSandboxProcessOptions,
  ) => Promise<SandboxProcessRun>;
}

interface ValidationRequest {
  readonly repository_root: string;
  readonly goal: string;
  readonly max_iterations: number;
  readonly test_command?: string;
  readonly timeout_per_iteration_ms: number;
}

export async function autoValidateTests(
  input: AutoValidateTestsInput,
): Promise<TaskResponse<AutoValidateResult>> {
  const parsed = AutoValidateInputSchema.parse(input.request);
  const request: ValidationRequest = {
    repository_root: parsed.repository_root,
    goal: parsed.goal,
    max_iterations: parsed.max_iterations ?? 3,
    ...(parsed.test_command === undefined
      ? {}
      : { test_command: parsed.test_command }),
    timeout_per_iteration_ms: parsed.timeout_per_iteration_ms ?? 120_000,
  };
  const capability = await (
    input.capabilityFactory ?? createRepositoryReadCapability
  )({ repositoryRoot: request.repository_root });
  const runtime = createTaskRuntime({
    goal: request.goal,
    configuration: input.configuration,
    resultSchema: AutoValidateResultSchema,
    inference: input.inference,
    language: input.language,
    model: resolveModelForTask(input.configuration, "test_proposal"),
    ...(input.signal === undefined ? {} : { callerSignal: input.signal }),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.createTaskId === undefined
      ? {}
      : { createTaskId: input.createTaskId }),
    ...(input.onTerminal === undefined ? {} : { onTerminal: input.onTerminal }),
  });

  return await runTaskWithCapacity(
    input.coordinator,
    runtime,
    (context) => runValidationLoop(input, request, capability, context),
    input.signal === undefined ? {} : { signal: input.signal },
  );
}

async function runValidationLoop(
  input: AutoValidateTestsInput,
  request: ValidationRequest,
  capability: RepositoryReadCapability,
  context: TaskExecutionContext,
): Promise<TaskWorkOutcome<AutoValidateResult>> {
  context.reportProgress("exploring");
  const sandbox = await createLoopSandbox(input, request);
  if (sandbox.status === "blocked") {
    return sandbox.outcome;
  }
  try {
    const detected = await resolveTestCommand(input, request, sandbox.root);
    if (detected.status === "blocked") {
      return detected.outcome;
    }
    const testCommand = detected.command;
    const commandText = detected.displayText;

    const beforeCoverage = await measureCoverage({
      sandboxRoot: sandbox.root,
      testCommand,
      timeout_ms: request.timeout_per_iteration_ms,
      signal: context.signal,
      ...(input.commandRunner === undefined
        ? {}
        : { commandRunner: input.commandRunner }),
    });

    const infrastructure = await detectTestInfrastructure(capability);
    const snapshot = await snapshotRepository(capability, infrastructure);
    const attempts: AutoValidateAttempt[] = [];
    let bestAttempt: AutoValidateAttempt | undefined;
    let refinement: Record<string, unknown> | undefined;

    for (
      let iteration = 1;
      iteration <= request.max_iterations;
      iteration += 1
    ) {
      if (context.signal.aborted) {
        throw new DOMException(
          "The auto-validate task was aborted.",
          "AbortError",
        );
      }
      context.reportProgress("consulting_model");
      input.onIterationProgress?.({
        iteration,
        status: "generating",
      });
      const generation = await generateProposal(
        context,
        input.language,
        request,
        snapshot,
        refinement,
      );
      if (generation.status === "blocked") {
        return generation.outcome;
      }
      const validated = generation.validated;
      const attempt = await runAttempt(
        input,
        context,
        request,
        sandbox.root,
        testCommand,
        iteration,
        validated,
      );
      attempts.push(attempt);
      input.onIterationProgress?.({
        iteration,
        status: "analyzing",
        ...(attempt.apply_error === undefined
          ? { test_results: attempt.test_results }
          : {}),
      });
      if (bestAttempt === undefined || attemptBeats(attempt, bestAttempt)) {
        bestAttempt = attempt;
      }
      if (attempt.passed) {
        const afterCoverage = await measureCoverage({
          sandboxRoot: sandbox.root,
          testCommand,
          timeout_ms: request.timeout_per_iteration_ms,
          signal: context.signal,
          ...(input.commandRunner === undefined
            ? {}
            : { commandRunner: input.commandRunner }),
        });
        return completedValidated(
          request,
          commandText,
          attempts,
          bestAttempt,
          buildCoverageDelta(beforeCoverage, afterCoverage),
        );
      }
      refinement = refinementPrompt(request.goal, attempt);
    }

    context.reportProgress("preparing_result");
    const afterCoverage = await measureCoverage({
      sandboxRoot: sandbox.root,
      testCommand,
      timeout_ms: request.timeout_per_iteration_ms,
      signal: context.signal,
      ...(input.commandRunner === undefined
        ? {}
        : { commandRunner: input.commandRunner }),
    });
    return completedExhausted(
      request,
      commandText,
      attempts,
      bestAttempt,
      input.language,
      buildCoverageDelta(beforeCoverage, afterCoverage),
    );
  } finally {
    await sandbox.dispose().catch(() => undefined);
  }
}

async function createLoopSandbox(
  input: AutoValidateTestsInput,
  request: ValidationRequest,
): Promise<
  | { status: "ready"; root: string; dispose(): Promise<void> }
  | { status: "blocked"; outcome: TaskWorkOutcome<AutoValidateResult> }
> {
  const factory = input.sandboxFactory ?? createSandbox;
  try {
    const sandbox = await factory({ sourceRoot: request.repository_root });
    return {
      status: "ready",
      root: sandbox.root,
      dispose: () => sandbox.dispose(),
    };
  } catch {
    return {
      status: "blocked",
      outcome: {
        status: "blocked",
        diagnostic: createDiagnostic({
          code: "invalid_configuration",
          message: {
            language: input.language,
            text: "The repository could not be copied into an isolated sandbox.",
          },
        }),
      },
    };
  }
}

async function resolveTestCommand(
  input: AutoValidateTestsInput,
  request: ValidationRequest,
  sandboxRoot: string,
): Promise<
  | { status: "ready"; command: DetectedTestCommand; displayText: string }
  | { status: "blocked"; outcome: TaskWorkOutcome<AutoValidateResult> }
> {
  if (request.test_command !== undefined) {
    const tokens = splitCommand(request.test_command);
    if (tokens.length === 0) {
      return {
        status: "blocked",
        outcome: {
          status: "blocked",
          diagnostic: createDiagnostic({
            code: "invalid_request",
            message: {
              language: input.language,
              text: "The provided test command is empty.",
            },
          }),
        },
      };
    }
    const [command, ...args] = tokens;
    return {
      status: "ready",
      command: { command: command ?? "", args },
      displayText: request.test_command,
    };
  }
  const detector = input.commandDetector ?? detectTestCommand;
  const detected = await detector(sandboxRoot);
  if (detected === undefined) {
    return {
      status: "blocked",
      outcome: {
        status: "blocked",
        diagnostic: createDiagnostic({
          code: "invalid_configuration",
          message: {
            language: input.language,
            text: "No test command could be auto-detected. Provide test_command explicitly.",
          },
        }),
        limitations: [
          {
            code: "missing_test_infrastructure",
            description: {
              language: input.language,
              text: "The sandbox copy has no detectable test convention.",
            },
            impact: {
              language: input.language,
              text: "No validation loop was executed.",
            },
            affected_paths: [],
          },
        ],
      },
    };
  }
  return {
    status: "ready",
    command: detected,
    displayText: [detected.command, ...detected.args].join(" "),
  };
}

async function snapshotRepository(
  capability: RepositoryReadCapability,
  infrastructure: readonly {
    readonly kind: string;
    readonly config_files: readonly string[];
    readonly test_directories: readonly string[];
  }[],
): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {
    infrastructure,
    root_listing: [],
  };
  try {
    const listing = await capability.listDirectory({});
    snapshot.root_listing = listing.entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
    }));
  } catch {
    snapshot.root_listing = [];
  }
  const configFiles = infrastructure.flatMap((item) => item.config_files);
  const configContents: { path: string; content: string }[] = [];
  for (const configPath of [...new Set(configFiles)].slice(0, 5)) {
    try {
      const snippet = await capability.readSnippet({
        path: configPath,
        line_count: 100,
      });
      configContents.push({ path: configPath, content: snippet.content });
    } catch {
      // Unreadable configuration files are omitted.
    }
  }
  snapshot.config_files = configContents;
  const testDirectories = infrastructure.flatMap(
    (item) => item.test_directories,
  );
  const testListings: { path: string; entries: readonly string[] }[] = [];
  for (const directory of [...new Set(testDirectories)].slice(0, 10)) {
    try {
      const listing = await capability.listDirectory({ path: directory });
      testListings.push({
        path: directory,
        entries: listing.entries.map((entry) => entry.path),
      });
    } catch {
      // Unreadable test directories are omitted.
    }
  }
  snapshot.test_directories = testListings;
  return snapshot;
}

async function generateProposal(
  context: TaskExecutionContext,
  language: RequestLanguage,
  request: ValidationRequest,
  snapshot: Record<string, unknown>,
  refinement: unknown,
): Promise<
  | {
      status: "ready";
      validated: ValidatedTestPatch;
      proposal: AutoValidateProposal;
    }
  | { status: "blocked"; outcome: TaskWorkOutcome<AutoValidateResult> }
> {
  const { text: prompt } = composeUntrustedPrompt({
    task: {
      requested_language: language,
      goal: request.goal,
      constraints: {
        max_files: context.configuration.fixed_limits.patch_max_files,
        max_changed_lines:
          context.configuration.fixed_limits.patch_max_changed_lines,
      },
    },
    data: {
      repository: snapshot,
      ...(refinement === undefined ? {} : { previous_attempt: refinement }),
    },
  });
  context.content.append("prompts", prompt);
  const response = await context.inferStructured({
    messages: [
      { role: "system", content: systemProtocol },
      { role: "user", content: prompt },
    ],
    output_name: "test_proposal",
    output_schema: AutoValidateProposalSchema,
    max_tokens: 12_000,
  });
  context.content.append("responses", JSON.stringify(response.output));
  if (response.output.unresolved_conflicts.length > 0) {
    return {
      status: "blocked",
      outcome: {
        status: "blocked",
        diagnostic: createDiagnostic({
          code: "invalid_evidence",
          message: {
            language,
            text: "Conflicting behavior sources require a developer decision before tests can be auto-validated.",
          },
        }),
      },
    };
  }
  let validated: ValidatedTestPatch;
  try {
    validated = await validateTestPatch({
      patch: response.output.patch,
      repositoryRoot: request.repository_root,
      maxFiles: context.configuration.fixed_limits.patch_max_files,
      maxChangedLines:
        context.configuration.fixed_limits.patch_max_changed_lines,
    });
  } catch (error: unknown) {
    if (error instanceof PatchPolicyError) {
      return {
        status: "blocked",
        outcome: {
          status: "blocked",
          diagnostic: createDiagnostic({
            code:
              error.code === "malformed_patch"
                ? "patch_not_allowed"
                : error.code,
            message: { language, text: error.message },
          }),
        },
      };
    }
    throw error;
  }
  const affectedFiles = validated.files.map((file) => file.path);
  if (!samePathSet(affectedFiles, response.output.affected_files)) {
    return {
      status: "blocked",
      outcome: {
        status: "blocked",
        diagnostic: createDiagnostic({
          code: "patch_not_allowed",
          message: {
            language,
            text: "The declared affected files do not match the parsed patch.",
          },
        }),
      },
    };
  }
  context.content.append("patches", validated.patch);
  return { status: "ready", validated, proposal: response.output };
}

async function runAttempt(
  input: AutoValidateTestsInput,
  context: TaskExecutionContext,
  request: ValidationRequest,
  sandboxRoot: string,
  testCommand: DetectedTestCommand,
  iteration: number,
  validated: ValidatedTestPatch,
): Promise<AutoValidateAttempt> {
  input.onIterationProgress?.({ iteration, status: "applying" });
  const affectedFiles = validated.files.map((file) => file.path);
  try {
    await applyValidatedPatch({ root: sandboxRoot, patch: validated });
  } catch (error: unknown) {
    if (error instanceof PatchApplyError) {
      return AutoValidateAttemptSchema.parse({
        iteration,
        patch: validated.patch,
        affected_files: affectedFiles,
        passed: false,
        exit_code: null,
        timed_out: false,
        test_results: emptyResults(),
        apply_error: error.message,
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_excerpt: "",
        stderr_excerpt: error.message,
      });
    }
    throw error;
  }

  input.onIterationProgress?.({ iteration, status: "running" });
  const runner = input.commandRunner ?? runSandboxProcess;
  const run = await runner({
    command: testCommand.command,
    args: [...testCommand.args],
    cwd: sandboxRoot,
    timeout_ms: request.timeout_per_iteration_ms,
    signal: context.signal,
  });
  const testResults = parseTestResults(run);
  const passed =
    run.error === null &&
    !run.timed_out &&
    run.exit_code === 0 &&
    testResults.passed >= 1 &&
    testResults.failed === 0 &&
    testResults.errors === 0;
  return AutoValidateAttemptSchema.parse({
    iteration,
    patch: validated.patch,
    affected_files: affectedFiles,
    passed,
    exit_code: run.timed_out ? null : run.exit_code,
    timed_out: run.timed_out,
    test_results: testResults,
    stdout_truncated: run.stdout_truncated,
    stderr_truncated: run.stderr_truncated,
    stdout_excerpt: excerpt(run.stdout),
    stderr_excerpt: excerpt(run.stderr),
  });
}

function buildCoverageDelta(
  before: CoverageMeasurement | undefined,
  after: CoverageMeasurement | undefined,
): CoverageDelta | undefined {
  if (before === undefined && after === undefined) {
    return undefined;
  }
  return {
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(before !== undefined && after !== undefined
      ? {
          delta_percent:
            Math.round(
              (after.line_coverage_percent - before.line_coverage_percent) *
                100,
            ) / 100,
        }
      : {}),
  };
}

function completedValidated(
  request: ValidationRequest,
  commandText: string,
  attempts: readonly AutoValidateAttempt[],
  bestAttempt: AutoValidateAttempt,
  coverageDelta: CoverageDelta | undefined,
): TaskWorkOutcome<AutoValidateResult> {
  return {
    status: "completed",
    result: {
      status: "validated",
      test_command: commandText,
      iteration_count: attempts.length,
      max_iterations: request.max_iterations,
      attempts: [...attempts],
      patch: bestAttempt.patch,
      test_results: bestAttempt.test_results,
      diagnostics: [],
      limitations: [],
      ...(coverageDelta === undefined ? {} : { coverage_delta: coverageDelta }),
    },
  };
}

function completedExhausted(
  request: ValidationRequest,
  commandText: string,
  attempts: readonly AutoValidateAttempt[],
  bestAttempt: AutoValidateAttempt | undefined,
  language: RequestLanguage,
  coverageDelta: CoverageDelta | undefined,
): TaskWorkOutcome<AutoValidateResult> {
  const selected =
    bestAttempt ?? attempts[attempts.length - 1] ?? emptyAttempt();
  const summary = bestAttempt?.test_results ?? emptyResults();
  const diagnostic: Diagnostic = createDiagnostic({
    code: "patch_not_allowed",
    message: {
      language,
      text: `The best attempt still fails: ${summary.failed} failed and ${summary.errors} errors.`,
    },
    issues:
      bestAttempt?.apply_error === undefined
        ? []
        : [
            {
              message: {
                language,
                text: `The patch could not be applied to the sandbox: ${bestAttempt.apply_error}`,
              },
            },
          ],
  });
  const limitation: Limitation = {
    code: "unvalidated_tests",
    description: {
      language,
      text: "No attempt produced a fully green test run within the iteration limit.",
    },
    impact: {
      language,
      text: "The best attempt is returned unvalidated with its failing evidence.",
    },
    affected_paths: selected.affected_files,
  };
  return {
    status: "completed",
    result: {
      status: "exhausted",
      test_command: commandText,
      iteration_count: attempts.length,
      max_iterations: request.max_iterations,
      attempts: [...attempts],
      patch: selected.patch,
      diagnostics: [diagnostic],
      limitations: [limitation],
      ...(coverageDelta === undefined ? {} : { coverage_delta: coverageDelta }),
    },
  };
}

function refinementPrompt(
  goal: string,
  attempt: AutoValidateAttempt,
): Record<string, unknown> {
  return {
    goal,
    iteration: attempt.iteration,
    patch: attempt.patch,
    passed: attempt.passed,
    exit_code: attempt.exit_code,
    timed_out: attempt.timed_out,
    test_results: attempt.test_results,
    ...(attempt.apply_error === undefined
      ? {}
      : { apply_error: attempt.apply_error }),
    stdout_excerpt: attempt.stdout_excerpt,
    stderr_excerpt: attempt.stderr_excerpt,
    stdout_truncated: attempt.stdout_truncated,
    stderr_truncated: attempt.stderr_truncated,
  };
}

function attemptBeats(
  candidate: AutoValidateAttempt,
  current: AutoValidateAttempt,
): boolean {
  const candidateFailures =
    candidate.test_results.failed + candidate.test_results.errors;
  const currentFailures =
    current.test_results.failed + current.test_results.errors;
  if (candidateFailures !== currentFailures) {
    return candidateFailures < currentFailures;
  }
  if (candidate.test_results.passed !== current.test_results.passed) {
    return candidate.test_results.passed > current.test_results.passed;
  }
  return candidate.iteration < current.iteration;
}

function parseTestResults(run: SandboxProcessRun): TestRunSummary {
  const text = `${run.stdout}\n${run.stderr}`;
  return {
    passed: largestMetric(text, /(\d+)\s+passed/gu),
    failed: largestMetric(text, /(\d+)\s+failed/gu),
    errors: largestMetric(text, /(\d+)\s+errors?\b/gu),
  };
}

function largestMetric(text: string, pattern: RegExp): number {
  let largest = 0;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > largest) {
      largest = value;
    }
  }
  return largest;
}

function emptyResults(): TestRunSummary {
  return { passed: 0, failed: 0, errors: 0 };
}

function emptyAttempt(): AutoValidateAttempt {
  return AutoValidateAttemptSchema.parse({
    iteration: 1,
    patch: "",
    affected_files: [],
    passed: false,
    exit_code: null,
    timed_out: false,
    test_results: emptyResults(),
    stdout_truncated: false,
    stderr_truncated: false,
    stdout_excerpt: "",
    stderr_excerpt: "",
  });
}

function excerpt(output: string): string {
  return output.length > 4_000 ? output.slice(0, 4_000) : output;
}

function samePathSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((path) => right.includes(path))
  );
}
