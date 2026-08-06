import { createHash } from "node:crypto";

import { z } from "zod";

import {
  resolveModelForTask,
  type EffectiveConfiguration,
  type ModelScore,
} from "../configuration/index.js";
import {
  composeSystemProtocol,
  composeUntrustedPrompt,
  type ModelInferencePort,
} from "../model-inference/index.js";
import {
  createDiagnostic,
  createTaskRuntime,
  runTaskWithCapacity,
  type Evidence,
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
  ExplorationRequestSchema,
  ListDirectoryInputSchema,
  ReadSnippetInputSchema,
  RepositoryAccessError,
  SearchTextInputSchema,
  type ExplorationRequest,
  type RepositoryReadCapability,
} from "./contracts.js";
import {
  ContentCollectionError,
  createOutboundContextCollector,
  type ContentLimitation,
  type CreateOutboundContextCollectorInput,
  type OutboundContextCollector,
} from "./content-filter.js";
import {
  createRepositoryReadCapability,
  type CreateRepositoryReadCapabilityInput,
} from "./repository-access.js";

const BoundedTextSchema = z.string().trim().min(1).max(8_000);
const BoundedPathSchema = z.string().trim().min(1).max(4_096);

const ProposedEvidenceSchema = z
  .object({
    path: BoundedPathSchema,
    start_line: z.number().int().min(1).max(10_000_000),
    end_line: z.number().int().min(1).max(10_000_000),
    explanation: BoundedTextSchema,
  })
  .strict();

const ExplorationDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list_directory"),
      input: ListDirectoryInputSchema,
      relevance: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("search_text"),
      input: SearchTextInputSchema,
      relevance: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("read_snippet"),
      input: ReadSnippetInputSchema,
      relevance: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("finalize"),
      summary: BoundedTextSchema,
      relevant_files: z.array(BoundedPathSchema).max(200),
      evidence: z.array(ProposedEvidenceSchema).max(200),
      risks: z.array(BoundedTextSchema).max(100),
      next_steps: z.array(BoundedTextSchema).max(100),
    })
    .strict(),
]);

const LocalizedTextSchema = z
  .object({
    language: z.string().trim().min(2).max(35),
    text: BoundedTextSchema,
  })
  .strict();

export const ExplorationResultSchema = z
  .object({
    summary: LocalizedTextSchema,
    relevant_files: z.array(BoundedPathSchema),
    risks: z.array(LocalizedTextSchema),
    next_steps: z.array(LocalizedTextSchema),
    analyzed_files: z.array(BoundedPathSchema),
    relevant_unread_files: z.array(BoundedPathSchema),
    limitation_impact: LocalizedTextSchema.nullable(),
  })
  .strict();

export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;

export interface ExploreRepositoryInput {
  readonly request: unknown;
  readonly configuration: EffectiveConfiguration;
  readonly inference: ModelInferencePort;
  readonly coordinator: TaskCapacityCoordinator;
  readonly language: RequestLanguage;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: TaskProgressEvent) => void;
  readonly createTaskId?: () => string;
  readonly onTerminal?: (event: TaskTerminalMetadata) => void | Promise<void>;
  /** Recorded outcomes for adaptive routing; absent means route statically. */
  readonly routingScores?: readonly ModelScore[] | undefined;
  readonly capabilityFactory?: (
    input: CreateRepositoryReadCapabilityInput,
  ) => Promise<RepositoryReadCapability>;
  readonly collectorFactory?: (
    input: CreateOutboundContextCollectorInput,
  ) => Promise<OutboundContextCollector>;
}

interface Observation {
  readonly operation: "list_directory" | "search_text" | "read_snippet";
  readonly result: unknown;
}

const systemProtocol = composeSystemProtocol([
  "You analyze a repository through a closed protocol.",
  "Choose exactly one action: list_directory, search_text, read_snippet, or finalize.",
  "You have no shell, network, write, command, or generic tool capability.",
  "Cite only paths and inclusive line ranges present in accepted repository excerpts.",
  "Return human explanations in the requested language; keep technical fields in English.",
]);

export async function exploreRepository(
  input: ExploreRepositoryInput,
): Promise<TaskResponse<ExplorationResult>> {
  const parsedRequest = ExplorationRequestSchema.parse(input.request);
  const request: ExplorationRequest = {
    goal: parsedRequest.goal,
    repository_root: parsedRequest.repository_root,
    ...(parsedRequest.priority_paths === undefined
      ? {}
      : { priority_paths: parsedRequest.priority_paths }),
  };
  const capabilityFactory =
    input.capabilityFactory ?? createRepositoryReadCapability;
  const capability = await capabilityFactory({
    repositoryRoot: request.repository_root,
    ...(request.priority_paths === undefined
      ? {}
      : { priorityPaths: request.priority_paths }),
  });
  const collectorFactory =
    input.collectorFactory ?? createOutboundContextCollector;
  const collector = await collectorFactory({
    repositoryRoot: request.repository_root,
    goal: request.goal,
    contextBudgetBytes: input.configuration.limits.context_budget_bytes,
    maxInteractions: input.configuration.limits.max_exploration_interactions,
  });
  const runtime = createTaskRuntime({
    goal: request.goal,
    configuration: input.configuration,
    resultSchema: ExplorationResultSchema,
    inference: input.inference,
    language: input.language,
    model: resolveModelForTask(input.configuration, "exploration", {
      ...(input.routingScores === undefined
        ? {}
        : { scores: input.routingScores }),
    }),
    taskType: "exploration",
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
    (context) =>
      runExploration(request, capability, collector, context, input.language),
    input.signal === undefined ? {} : { signal: input.signal },
  );
}

async function runExploration(
  request: ExplorationRequest,
  capability: RepositoryReadCapability,
  collector: OutboundContextCollector,
  context: TaskExecutionContext,
  language: RequestLanguage,
): Promise<TaskWorkOutcome<ExplorationResult>> {
  const observations: Observation[] = [];
  context.reportProgress("exploring");

  while (true) {
    try {
      collector.recordInteraction();
    } catch (error: unknown) {
      if (
        error instanceof ContentCollectionError &&
        error.code === "interaction_limit_exceeded"
      ) {
        return blocked(
          "interaction_limit_exceeded",
          language,
          "The exploration interaction limit prevented a complete analysis.",
        );
      }
      throw error;
    }
    context.reportProgress("consulting_model");
    const { text: prompt } = composeUntrustedPrompt({
      task: {
        requested_language: language,
        priority_paths: request.priority_paths ?? [],
      },
      data: { context: collector.snapshot(), observations },
    });
    context.content.append("prompts", prompt);
    const decisionResult = await context.inferStructured({
      messages: [
        { role: "system", content: systemProtocol },
        { role: "user", content: prompt },
      ],
      output_name: "repository_exploration_step",
      output_schema: ExplorationDecisionSchema,
      max_tokens: 4_096,
    });
    context.content.append("responses", JSON.stringify(decisionResult.output));
    const decision = decisionResult.output;

    if (decision.action === "finalize") {
      context.reportProgress("preparing_result");
      return await finalize(decision, collector, capability, language);
    }

    context.reportProgress("exploring");
    observations.push(await executeOperation(decision, capability, collector));
  }
}

async function executeOperation(
  decision: Exclude<
    z.infer<typeof ExplorationDecisionSchema>,
    { readonly action: "finalize" }
  >,
  capability: RepositoryReadCapability,
  collector: OutboundContextCollector,
): Promise<Observation> {
  try {
    if (decision.action === "list_directory") {
      const listing = await capability.listDirectory({
        ...(decision.input.path === undefined
          ? {}
          : { path: decision.input.path }),
        ...(decision.input.max_entries === undefined
          ? {}
          : { max_entries: decision.input.max_entries }),
      });
      const safeEntries = [];
      for (const entry of listing.entries) {
        if ((await collector.assessPath(entry.path)).accepted) {
          safeEntries.push({ path: entry.path, kind: entry.kind });
        }
      }
      return {
        operation: "list_directory",
        result: { entries: safeEntries, truncated: listing.truncated },
      };
    }
    if (decision.action === "search_text") {
      const search = await capability.searchText({
        query: decision.input.query,
        ...(decision.input.path === undefined
          ? {}
          : { path: decision.input.path }),
        ...(decision.input.mode === undefined
          ? {}
          : { mode: decision.input.mode }),
        ...(decision.input.case_sensitive === undefined
          ? {}
          : { case_sensitive: decision.input.case_sensitive }),
        ...(decision.input.max_results === undefined
          ? {}
          : { max_results: decision.input.max_results }),
      });
      for (const match of search.matches) {
        await collector.addExcerpt({
          path: match.path,
          start_line: match.line,
          end_line: match.line,
          content: match.preview,
          relevance: decision.relevance,
        });
      }
      return {
        operation: "search_text",
        result: {
          accepted_matches: collector.snapshot().excerpts.length,
          visited_files: search.visited_files,
          scanned_bytes: search.scanned_bytes,
          truncated: search.truncated,
        },
      };
    }
    const snippet = await capability.readSnippet({
      path: decision.input.path,
      ...(decision.input.start_line === undefined
        ? {}
        : { start_line: decision.input.start_line }),
      ...(decision.input.line_count === undefined
        ? {}
        : { line_count: decision.input.line_count }),
    });
    const accepted = await collector.addExcerpt({
      ...snippet,
      relevance: decision.relevance,
    });
    return {
      operation: "read_snippet",
      result: {
        path: snippet.path,
        start_line: snippet.start_line,
        end_line: snippet.end_line,
        accepted: accepted.accepted,
        reason: accepted.reason ?? null,
        truncated: snippet.truncated,
      },
    };
  } catch (error: unknown) {
    if (error instanceof RepositoryAccessError) {
      const candidatePath =
        "input" in decision && "path" in decision.input
          ? decision.input.path
          : undefined;
      if (candidatePath !== undefined) {
        collector.recordUnreadRelevant(candidatePath);
      }
      return {
        operation: decision.action,
        result: { error: error.code },
      };
    }
    throw error;
  }
}

async function finalize(
  decision: Extract<
    z.infer<typeof ExplorationDecisionSchema>,
    { readonly action: "finalize" }
  >,
  collector: OutboundContextCollector,
  capability: RepositoryReadCapability,
  language: RequestLanguage,
): Promise<TaskWorkOutcome<ExplorationResult>> {
  const snapshot = collector.snapshot();
  const included = snapshot.manifest.files.filter(
    (file) => file.status === "included",
  );
  const analyzedFiles = unique(included.map((file) => file.path));
  if (decision.relevant_files.some((path) => !analyzedFiles.includes(path))) {
    return blocked(
      "invalid_evidence",
      language,
      "The model named a relevant file that was not analyzed.",
    );
  }

  const evidence: Evidence[] = [];
  for (const proposed of decision.evidence) {
    const record = included.find(
      (candidate) =>
        candidate.path === proposed.path &&
        candidate.start_line !== undefined &&
        candidate.end_line !== undefined &&
        candidate.start_line <= proposed.start_line &&
        candidate.end_line >= proposed.end_line,
    );
    if (
      record === undefined ||
      record.start_line === undefined ||
      record.end_line === undefined ||
      record.fingerprint === undefined
    ) {
      return blocked(
        "invalid_evidence",
        language,
        "The model cited a path or line range outside analyzed content.",
      );
    }
    let current;
    try {
      current = await capability.readSnippet({
        path: record.path,
        start_line: record.start_line,
        line_count: record.end_line - record.start_line + 1,
      });
    } catch {
      return blocked(
        "invalid_evidence",
        language,
        "Cited repository content could not be verified before delivery.",
      );
    }
    if (fingerprint(current.content) !== record.fingerprint) {
      return blocked(
        "invalid_evidence",
        language,
        "Cited repository content changed before delivery.",
      );
    }
    evidence.push({
      path: proposed.path,
      start_line: proposed.start_line,
      end_line: proposed.end_line,
      explanation: { language, text: proposed.explanation },
    });
  }

  const limitations = snapshot.manifest.limitations.map((limitation) =>
    taskLimitation(limitation, language),
  );
  const unread = unique(
    snapshot.manifest.files
      .filter((file) => file.status !== "included")
      .map((file) => file.path),
  );

  return {
    status: "completed",
    result: {
      summary: { language, text: decision.summary },
      relevant_files: unique(decision.relevant_files),
      risks: decision.risks.map((text) => ({ language, text })),
      next_steps: decision.next_steps.map((text) => ({ language, text })),
      analyzed_files: analyzedFiles,
      relevant_unread_files: unread,
      limitation_impact: limitationImpact(
        snapshot.manifest.limitations,
        language,
      ),
    },
    evidence,
    limitations,
  };
}

function blocked(
  code: "interaction_limit_exceeded" | "invalid_evidence",
  language: RequestLanguage,
  text: string,
): TaskWorkOutcome<ExplorationResult> {
  return {
    status: "blocked",
    diagnostic: createDiagnostic({
      code,
      message: { language, text },
    }),
  };
}

function taskLimitation(
  limitation: ContentLimitation,
  language: RequestLanguage,
): Limitation {
  const portuguese = language.toLowerCase().startsWith("pt");
  return {
    code: limitation.reason,
    description: {
      language,
      text: portuguese
        ? "Parte do contexto relevante foi omitida pela política local."
        : "Some relevant context was omitted by local policy.",
    },
    impact: {
      language,
      text:
        limitation.impact === "prevents_safe_repository_analysis"
          ? portuguese
            ? "A omissão pode impedir uma análise segura e completa."
            : "The omission may prevent a safe complete analysis."
          : portuguese
            ? "A omissão pode reduzir a completude da análise."
            : "The omission may reduce analysis completeness.",
    },
    affected_paths: limitation.path === undefined ? [] : [limitation.path],
  };
}

function limitationImpact(
  limitations: readonly ContentLimitation[],
  language: RequestLanguage,
): { readonly language: string; readonly text: string } | null {
  if (limitations.length === 0) {
    return null;
  }
  const prevents = limitations.some(
    (limitation) => limitation.impact === "prevents_safe_repository_analysis",
  );
  const portuguese = language.toLowerCase().startsWith("pt");
  return {
    language,
    text: prevents
      ? portuguese
        ? "As limitações podem impedir uma análise segura e completa."
        : "Limitations may prevent a safe complete analysis."
      : portuguese
        ? "As limitações podem reduzir a completude da análise."
        : "Limitations may reduce analysis completeness.",
  };
}

function fingerprint(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
