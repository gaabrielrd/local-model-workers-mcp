import os from "node:os";

import {
  McpServer,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import {
  CONFIGURATION_ENVIRONMENT_VARIABLES,
  FEATURE_GROUPS,
  getConfig,
  getEffectiveConfiguration,
  resolveModelForTask,
  updateConfig,
  validateConfig,
  type EffectiveConfiguration,
  type FeatureGroup,
} from "../configuration/index.js";
import { checkHealth } from "../health/index.js";
import { createLmStudioClient } from "../model-inference/index.js";
import {
  createOperationalLogStore,
  resolveOperationalLogDirectory,
  type OperationalEventRecorder,
} from "../operational-logging/index.js";
import {
  createRepositoryReadCapability,
  exploreRepository,
} from "../repository-exploration/index.js";
import {
  createFileSystemCapacityCoordinator,
  resolveCapacityStateDirectory,
  type TaskCapacityCoordinator,
  type TaskProgressEvent,
} from "../task-execution/index.js";
import { proposeTests } from "../test-proposal/index.js";
import {
  AutoValidateInputSchema,
  autoValidateTests,
  type AutoValidateProgressEvent,
} from "../auto-validate/index.js";
import {
  executeSemanticSearch,
  InMemoryVectorIndex,
  SemanticSearchInputSchema,
  type VectorIndex,
} from "../semantic-search/index.js";
import {
  CodeGraphQueryInputSchema,
  InMemoryCodeGraph,
  parseSourceSymbols,
} from "../code-graph/index.js";
import {
  InMemorySummarizationCache,
  SummarizationInputSchema,
  summarizeModule,
} from "../module-summary/index.js";
import {
  FixLintViolationsInputSchema,
  LintFixError,
  fixLintViolations,
} from "../lint-fix/index.js";
import {
  DocsGenerationError,
  GenerateDocsPatchInputSchema,
  generateDocsPatch,
} from "../docs-generation/index.js";
import { PACKAGE_INFO } from "../../shared/package-info.js";
import { TOOL_NAMES } from "./tool-names.js";

const LanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)
  .default("en");
const RepositoryTaskInputSchema = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    repository_root: z.string().trim().min(1).max(4_096),
    priority_paths: z
      .array(z.string().trim().min(1).max(4_096))
      .max(50)
      .optional(),
    language: LanguageSchema,
  })
  .strict();
const ProjectRootInputSchema = z
  .object({ project_root: z.string().trim().min(1).max(4_096).optional() })
  .strict();
const ProjectMutationInputSchema = z
  .object({
    project_root: z.string().trim().min(1).max(4_096),
    expected_revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    changes: z.record(z.string(), z.unknown()),
  })
  .strict();
const UpdateInputSchema = ProjectMutationInputSchema.extend({
  confirmation: z
    .object({
      approved: z.literal(true),
      proposal_id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    })
    .strict()
    .optional(),
}).strict();

export interface McpApplicationRuntime {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly startupConfiguration: EffectiveConfiguration;
  readonly bearerToken?: string;
  readonly operationalEvents: OperationalEventRecorder;
}

export interface CreateMcpApplicationRuntimeInput {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly operationalEvents?: OperationalEventRecorder;
}

export interface McpStdioApplication {
  close(): Promise<void>;
}

export async function createMcpApplicationRuntime(
  input: CreateMcpApplicationRuntimeInput = {},
): Promise<McpApplicationRuntime> {
  const environment = input.environment ?? process.env;
  const platform = input.platform ?? process.platform;
  const homeDirectory = input.homeDirectory ?? os.homedir();
  const startupConfiguration = await getEffectiveConfiguration({
    environment,
    platform,
    homeDirectory,
  });
  const bearerToken =
    environment[
      CONFIGURATION_ENVIRONMENT_VARIABLES.lmStudioBearerToken
    ]?.trim();
  const operationalEvents =
    input.operationalEvents ??
    createOperationalLogStore({
      directory: resolveOperationalLogDirectory(
        platform,
        homeDirectory,
        environment,
      ),
    });
  return Object.freeze({
    environment,
    platform,
    homeDirectory,
    startupConfiguration,
    ...(bearerToken === undefined || bearerToken.length === 0
      ? {}
      : { bearerToken }),
    operationalEvents,
  });
}

export function createMcpServer(
  runtime: McpApplicationRuntime,
  shutdownSignal: AbortSignal = new AbortController().signal,
): McpServer {
  const server = new McpServer(PACKAGE_INFO, {
    instructions:
      "Use repository tools for bounded read-only analysis. Test proposals are returned as unapplied diffs.",
    capabilities: { tools: {} },
  });

  if (featureEnabled(runtime, "exploration")) {
    server.registerTool(
      TOOL_NAMES.exploreRepository,
      {
        title: "Explore repository",
        description:
          "Analyze a bounded repository scope with locally verified evidence.",
        inputSchema: RepositoryTaskInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const dependencies = await taskDependencies(
            runtime,
            request.repository_root,
          );
          return await exploreRepository({
            request: repositoryRequest(request),
            configuration: dependencies.configuration,
            inference: dependencies.inference,
            coordinator: dependencies.coordinator,
            language: request.language,
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
            onProgress: progressReporter(context),
            onTerminal: (event) => runtime.operationalEvents.record(event),
          });
        }),
    );
  }

  if (featureEnabled(runtime, "tests")) {
    server.registerTool(
      TOOL_NAMES.proposeTests,
      {
        title: "Propose tests",
        description:
          "Return a locally validated test-only unified diff without applying it.",
        inputSchema: RepositoryTaskInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const dependencies = await taskDependencies(
            runtime,
            request.repository_root,
          );
          return await proposeTests({
            request: repositoryRequest(request),
            configuration: dependencies.configuration,
            inference: dependencies.inference,
            coordinator: dependencies.coordinator,
            language: request.language,
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
            onProgress: progressReporter(context),
            onTerminal: (event) => runtime.operationalEvents.record(event),
          });
        }),
    );

    server.registerTool(
      TOOL_NAMES.autoValidateTests,
      {
        title: "Auto-validate tests",
        description:
          "Generate test proposals, execute them in an isolated temporary copy, and iterate until they pass. The original repository is never modified.",
        inputSchema: AutoValidateInputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const parsed = AutoValidateInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsed.repository_root,
          );
          return await autoValidateTests({
            request,
            configuration: dependencies.configuration,
            inference: dependencies.inference,
            coordinator: dependencies.coordinator,
            language: "en",
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
            onIterationProgress: iterationProgressReporter(
              context,
              parsed.max_iterations ?? 3,
            ),
            onTerminal: (event) => runtime.operationalEvents.record(event),
          });
        }),
    );
  }

  if (featureEnabled(runtime, "exploration")) {
    const sharedVectorIndex: VectorIndex = new InMemoryVectorIndex();

    server.registerTool(
      TOOL_NAMES.searchSemantic,
      {
        title: "Search semantic",
        description:
          "Perform nearest-neighbor vector similarity search over repository embeddings.",
        inputSchema: SemanticSearchInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const parsedInput = SemanticSearchInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsedInput.repository_root,
          );
          const embeddingModel = resolveModelForTask(
            dependencies.configuration,
            "embedding",
          );

          return await executeSemanticSearch({
            input: parsedInput,
            inference: dependencies.inference,
            vectorIndex: sharedVectorIndex,
            repositoryRead: dependencies.repositoryRead,
            embeddingModel,
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
          });
        }),
    );

    const sharedCodeGraph = new InMemoryCodeGraph();

    server.registerTool(
      TOOL_NAMES.queryCodeGraph,
      {
        title: "Query code graph",
        description:
          "Query lightweight symbol graph (functions, classes, interfaces, type aliases, callers, dependencies, exports).",
        inputSchema: CodeGraphQueryInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request) =>
        safeToolCall(async () => {
          const parsedInput = CodeGraphQueryInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsedInput.repository_root,
          );

          // Populate / update graph if needed
          const listing = await dependencies.repositoryRead.listDirectory({});
          for (const entry of listing.entries) {
            if (entry.kind === "file") {
              try {
                const snippet = await dependencies.repositoryRead.readSnippet({
                  path: entry.path,
                  start_line: 1,
                  line_count: 500,
                });
                const symbols = parseSourceSymbols(entry.path, snippet.content);
                sharedCodeGraph.updateFile(entry.path, "hash", symbols);
              } catch {
                // Ignore unreadable files
              }
            }
          }

          return sharedCodeGraph.query(parsedInput);
        }),
    );

    const sharedSummarizationCache = new InMemorySummarizationCache();

    server.registerTool(
      TOOL_NAMES.summarizeModule,
      {
        title: "Summarize module",
        description:
          "Generate structured file or directory summaries from code-graph metadata and local inference.",
        inputSchema: SummarizationInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const parsedInput = SummarizationInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsedInput.repository_root,
          );
          const model = resolveModelForTask(
            dependencies.configuration,
            "summarization",
          );

          return await summarizeModule({
            input: parsedInput,
            inference: dependencies.inference,
            repositoryRead: dependencies.repositoryRead,
            model,
            cache: sharedSummarizationCache,
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
          });
        }),
    );
  }

  if (featureEnabled(runtime, "lint")) {
    server.registerTool(
      TOOL_NAMES.fixLintViolations,
      {
        title: "Fix lint violations",
        description:
          "Return a locally validated unified diff that fixes reported lint violations without writing.",
        inputSchema: FixLintViolationsInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const parsedInput = FixLintViolationsInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsedInput.repository_root,
          );
          return await fixLintViolations({
            input: parsedInput,
            inference: dependencies.inference,
            repositoryRead: dependencies.repositoryRead,
            model: resolveModelForTask(dependencies.configuration, "lint_fix"),
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
          });
        }),
    );
  }

  if (featureEnabled(runtime, "docs")) {
    server.registerTool(
      TOOL_NAMES.generateDocsPatch,
      {
        title: "Generate docs patch",
        description:
          "Return a locally validated unified diff that adds JSDoc/docstrings and docs/ markdown for public symbols without writing.",
        inputSchema: GenerateDocsPatchInputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (request, context) =>
        safeToolCall(async () => {
          const parsedInput = GenerateDocsPatchInputSchema.parse(request);
          const dependencies = await taskDependencies(
            runtime,
            parsedInput.repository_root,
          );
          return await generateDocsPatch({
            input: parsedInput,
            inference: dependencies.inference,
            repositoryRead: dependencies.repositoryRead,
            model: resolveModelForTask(
              dependencies.configuration,
              "docs_generation",
            ),
            signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
          });
        }),
    );
  }

  server.registerTool(
    TOOL_NAMES.checkHealth,
    {
      title: "Check health",
      description:
        "Check configuration, LM Studio authentication, and model availability.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (_request, context) =>
      safeToolCall(() =>
        checkHealth({
          loadConfiguration: () =>
            Promise.resolve({
              effective: runtime.startupConfiguration,
              ...(runtime.bearerToken === undefined
                ? {}
                : { bearer_token: runtime.bearerToken }),
            }),
          signal: AbortSignal.any([context.mcpReq.signal, shutdownSignal]),
        }),
      ),
  );

  server.registerTool(
    TOOL_NAMES.getConfig,
    {
      title: "Get configuration",
      description: "Return the effective redacted configuration.",
      inputSchema: ProjectRootInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (request) =>
      safeToolCall(() =>
        getConfig({
          ...(request.project_root === undefined
            ? {}
            : { projectRoot: request.project_root }),
          environment: runtime.environment,
          platform: runtime.platform,
          homeDirectory: runtime.homeDirectory,
        }),
      ),
  );

  server.registerTool(
    TOOL_NAMES.validateConfig,
    {
      title: "Validate project configuration",
      description:
        "Validate a revision-bound project configuration proposal without writing.",
      inputSchema: ProjectMutationInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (request) =>
      safeToolCall(() =>
        validateConfig({
          projectRoot: request.project_root,
          expected_revision: request.expected_revision,
          changes: request.changes,
          environment: runtime.environment,
          platform: runtime.platform,
          homeDirectory: runtime.homeDirectory,
        }),
      ),
  );

  server.registerTool(
    TOOL_NAMES.updateConfig,
    {
      title: "Update project configuration",
      description:
        "Atomically apply one explicitly approved revision-bound project proposal.",
      inputSchema: UpdateInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (request) =>
      safeToolCall(() =>
        updateConfig({
          projectRoot: request.project_root,
          expected_revision: request.expected_revision,
          changes: request.changes,
          ...(request.confirmation === undefined
            ? {}
            : { confirmation: request.confirmation }),
          environment: runtime.environment,
          platform: runtime.platform,
          homeDirectory: runtime.homeDirectory,
        }),
      ),
  );

  return server;
}

function featureEnabled(
  runtime: McpApplicationRuntime,
  feature: FeatureGroup,
): boolean {
  return (
    runtime.startupConfiguration.enabled_features ?? FEATURE_GROUPS
  ).includes(feature);
}

export function serveMcpStdio(
  runtime: McpApplicationRuntime,
): McpStdioApplication {
  const shutdown = new AbortController();
  const handle: StdioServerHandle = serveStdio(
    () => createMcpServer(runtime, shutdown.signal),
    {
      onerror: () => {
        // Protocol errors are intentionally not echoed with request data.
      },
    },
  );
  return {
    close: async () => {
      shutdown.abort();
      await handle.close();
    },
  };
}

async function taskDependencies(
  runtime: McpApplicationRuntime,
  projectRoot: string,
) {
  const configuration = await getEffectiveConfiguration({
    projectRoot,
    environment: runtime.environment,
    platform: runtime.platform,
    homeDirectory: runtime.homeDirectory,
  });
  const inference = createLmStudioClient({
    baseUrl: configuration.lm_studio.base_url,
    ...(runtime.bearerToken === undefined
      ? {}
      : { bearerToken: runtime.bearerToken }),
    allowedModels: configuration.lm_studio.allowed_models,
    retryCount: configuration.fixed_limits.inference_retry_count,
  });
  const coordinator: TaskCapacityCoordinator =
    createFileSystemCapacityCoordinator({
      stateDirectory: resolveCapacityStateDirectory({
        platform: runtime.platform,
        homeDirectory: runtime.homeDirectory,
        environment: runtime.environment,
      }),
      capacity: configuration.limits.max_concurrency,
    });
  const repositoryRead = await createRepositoryReadCapability({
    repositoryRoot: projectRoot,
  });
  return { configuration, inference, coordinator, repositoryRead };
}

function progressReporter(
  context: ServerContext,
): (event: TaskProgressEvent) => void {
  const progressToken = context.mcpReq._meta?.progressToken;
  return (event) => {
    if (progressToken === undefined) return;
    void context.mcpReq
      .notify({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: event.sequence,
          total: 4,
          message: event.stage,
        },
      })
      .catch(() => undefined);
  };
}

function iterationProgressReporter(
  context: ServerContext,
  maxIterations: number,
): (event: AutoValidateProgressEvent) => void {
  const progressToken = context.mcpReq._meta?.progressToken;
  return (event) => {
    if (progressToken === undefined) return;
    void context.mcpReq
      .notify({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: event.iteration,
          total: maxIterations,
          message: `${event.status} (iteration ${event.iteration}/${maxIterations})`,
        },
      })
      .catch(() => undefined);
  };
}

function repositoryRequest(
  request: z.infer<typeof RepositoryTaskInputSchema>,
): {
  readonly goal: string;
  readonly repository_root: string;
  readonly priority_paths?: readonly string[];
} {
  return {
    goal: request.goal,
    repository_root: request.repository_root,
    ...(request.priority_paths === undefined
      ? {}
      : { priority_paths: request.priority_paths }),
  };
}

async function safeToolCall(
  work: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const output = await work();
    const structured = asStructuredContent(output);
    return {
      content: [{ type: "text", text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch (error: unknown) {
    if (error instanceof LintFixError) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
    if (error instanceof DocsGenerationError) {
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: "The tool request could not be completed safely.",
        },
      ],
      isError: true,
    };
  }
}

function asStructuredContent(output: unknown): Record<string, unknown> {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    throw new Error("Tool output must be a structured object.");
  }
  return output as Record<string, unknown>;
}
