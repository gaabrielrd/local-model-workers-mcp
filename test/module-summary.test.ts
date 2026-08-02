import assert from "node:assert/strict";
import test from "node:test";

import {
  InferenceError,
  type ModelInferencePort,
  type StructuredInferenceRequest,
} from "../src/features/model-inference/index.js";
import type {
  CreateOutboundContextCollectorInput,
  OutboundContextCollector,
  RepositoryReadCapability,
} from "../src/features/repository-exploration/index.js";
import {
  RepositoryAccessError,
  createOutboundContextCollector,
} from "../src/features/repository-exploration/index.js";
import {
  InMemorySummarizationCache,
  SummarizationError,
  SummarizationResultSchema,
  summarizeModule,
  type SummarizationInput,
} from "../src/features/module-summary/index.js";

const ROOT = "/repo";
const MODEL = "qwen/default";

interface CapturedCall {
  readonly system: string;
  readonly user: string;
  readonly outputName: string;
}

void test("shallow summary of a single TypeScript file returns symbols, exports, dependencies, and a paragraph", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      `import { z } from "zod";`,
      "",
      "export interface UserProfile {",
      "  id: string;",
      "}",
      "",
      "export async function fetchUser(id: string): Promise<UserProfile> {",
      "  return { id };",
      "}",
      "",
      "const formatUser = (user: UserProfile) => user.name;",
      "",
    ].join("\n"),
  });

  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "src/app.ts" },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.equal(result.target, "src/app.ts");
  assert.equal(result.depth, "shallow");
  assert.equal(result.aggregate_summary, undefined);
  assert.equal(result.files.length, 1);

  const file = result.files[0]!;
  assert.equal(file.path, "src/app.ts");
  assert.equal(file.summary, "Summary of src/app.ts.");
  assert.equal(file.summary.includes("\n\n"), false);

  const kinds = file.symbols.map((symbol) => symbol.kind);
  assert.ok(kinds.includes("interface"));
  assert.ok(kinds.includes("function"));
  assert.ok(!kinds.includes("import"));
  assert.ok(file.symbols.some((symbol) => symbol.name === "fetchUser"));

  assert.ok(file.exports.includes("UserProfile"));
  assert.ok(file.exports.includes("fetchUser"));
  assert.deepEqual(file.dependencies, ["zod"]);
});

void test("deep summary includes dependency analysis and architectural observations", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": [
      `import { createHash } from "node:crypto";`,
      "",
      "export function digest(value: string): string {",
      '  return createHash("sha256").update(value).digest("hex");',
      "}",
      "",
    ].join("\n"),
  });

  const result = await summarizeModule({
    input: {
      repository_root: ROOT,
      target: "src/app.ts",
      depth: "deep",
    },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.equal(result.depth, "deep");
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.system ?? "", /multi-paragraph/u);
  assert.match(calls[0]?.system ?? "", /architectural observations/u);
  assert.match(calls[0]?.user ?? "", /node:crypto/u);
  assert.ok(result.files[0]!.summary.includes("\n\n"));
});

void test("directory summary aggregates individual file summaries", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/a.ts": 'export function a() {}\nimport { z } from "zod";',
    "src/b.ts": "export class B {}\n",
  });

  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "src" },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.deepEqual(
    result.files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"],
  );
  assert.equal(result.aggregate_summary, "Aggregate of 2 files");
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.outputName, "module_aggregate_summary");
});

void test("cached result is returned when content hash matches", async () => {
  const calls: CapturedCall[] = [];
  const cache = new InMemorySummarizationCache();
  const input: SummarizationInput = {
    repository_root: ROOT,
    target: "src/app.ts",
  };

  const unchanged = fakeRepoRead({ "src/app.ts": "export const value = 1;" });
  const first = await summarizeModule({
    input,
    inference: fakeInference(calls),
    repositoryRead: unchanged,
    model: MODEL,
    cache,
    collectorFactory: safeCollector,
  });
  const second = await summarizeModule({
    input,
    inference: fakeInference(calls),
    repositoryRead: unchanged,
    model: MODEL,
    cache,
    collectorFactory: safeCollector,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(second, first);

  const changed = fakeRepoRead({ "src/app.ts": "export const value = 2;" });
  await summarizeModule({
    input,
    inference: fakeInference(calls),
    repositoryRead: changed,
    model: MODEL,
    cache,
    collectorFactory: safeCollector,
  });
  assert.equal(calls.length, 2);
});

void test("force_refresh bypasses the cache and regenerates", async () => {
  const calls: CapturedCall[] = [];
  const cache = new InMemorySummarizationCache();
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export const value = 1;",
  });

  await summarizeModule({
    input: { repository_root: ROOT, target: "src/app.ts" },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    cache,
    collectorFactory: safeCollector,
  });
  await summarizeModule({
    input: {
      repository_root: ROOT,
      target: "src/app.ts",
      force_refresh: true,
    },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    cache,
    collectorFactory: safeCollector,
  });

  assert.equal(calls.length, 2);
});

void test("directory with more than 20 files returns an error suggesting subdivision", async () => {
  const files: Record<string, string> = {};
  for (let index = 1; index <= 25; index += 1) {
    files[`src/file${index}.ts`] = `export const value${index} = ${index};`;
  }
  const calls: CapturedCall[] = [];

  await assert.rejects(
    summarizeModule({
      input: { repository_root: ROOT, target: "src" },
      inference: fakeInference(calls),
      repositoryRead: fakeRepoRead(files),
      model: MODEL,
      collectorFactory: safeCollector,
    }),
    (error: unknown) =>
      error instanceof SummarizationError &&
      error.code === "too_many_files" &&
      /[Ss]ubdivi/u.test(error.message),
  );
  assert.equal(calls.length, 0);
});

void test("sensitive, ignored, and binary files are excluded", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export function app() {}\n",
    "src/.env": "SECRET=value",
    "src/secret.ts": 'const token = "sk-12345678901234567890";',
    "src/binary.dat": "abc\0def",
  });

  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "src" },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.deepEqual(
    result.files.map((file) => file.path),
    ["src/app.ts"],
  );
  assert.equal(calls.length, 1);
});

void test("a directly requested excluded file returns an empty files list", async () => {
  const calls: CapturedCall[] = [];
  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "src/.env" },
    inference: fakeInference(calls),
    repositoryRead: fakeRepoRead({ "src/.env": "SECRET=value" }),
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.deepEqual(result.files, []);
  assert.equal(calls.length, 0);
});

void test("cancellation during inference aborts cleanly", async () => {
  let inferenceStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    inferenceStarted = resolve;
  });
  const controller = new AbortController();

  const pending = summarizeModule({
    input: { repository_root: ROOT, target: "src/app.ts" },
    inference: cancellableInference(() => {
      inferenceStarted();
    }),
    repositoryRead: fakeRepoRead({
      "src/app.ts": "export function app() {}\n",
    }),
    model: MODEL,
    collectorFactory: safeCollector,
    signal: controller.signal,
  });

  await started;
  controller.abort();

  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof InferenceError && error.code === "inference_cancelled",
  );
});

void test("non-TypeScript/Python files return structural info only", async () => {
  const calls: CapturedCall[] = [];
  const repositoryRead = fakeRepoRead({
    "README.md": "# Readme\nSome documentation.",
  });

  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "README.md" },
    inference: fakeInference(calls),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.equal(calls.length, 0);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]!.summary, "");
  assert.deepEqual(result.files[0]!.symbols, []);
  assert.deepEqual(result.files[0]!.exports, []);
  assert.deepEqual(result.files[0]!.dependencies, []);
});

void test("summary output conforms to the defined JSON schema", async () => {
  const repositoryRead = fakeRepoRead({
    "src/app.ts": "export function app() {}\n",
    "src/other.ts": "export const other = 1;\n",
  });

  const result = await summarizeModule({
    input: { repository_root: ROOT, target: "src", depth: "deep" },
    inference: fakeInference(),
    repositoryRead,
    model: MODEL,
    collectorFactory: safeCollector,
  });

  assert.equal(SummarizationResultSchema.safeParse(result).success, true);
});

function fakeInference(calls: CapturedCall[] = []): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) => {
      const system =
        request.messages.find((message) => message.role === "system")
          ?.content ?? "";
      const user =
        request.messages.find((message) => message.role === "user")?.content ??
        "";
      calls.push({ system, user, outputName: request.output_name });

      const payload = JSON.parse(user) as {
        readonly task?: string;
        readonly path?: string;
        readonly depth?: "shallow" | "deep";
        readonly file_summaries?: readonly unknown[];
      };
      let summary: string;
      if (payload.task === "summarize_module_aggregate") {
        summary = `Aggregate of ${payload.file_summaries?.length ?? 0} files`;
      } else if (payload.depth === "deep") {
        summary = `Deep summary of ${payload.path}.\n\nDependency analysis and architectural observations for ${payload.path}.`;
      } else {
        summary = `Summary of ${payload.path}.`;
      }
      const output = request.output_schema.parse({ summary });
      return Promise.resolve({
        model: request.model,
        output,
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          reasoning_tokens: 0,
        },
      });
    },
  };
}

function cancellableInference(onStarted: () => void): ModelInferencePort {
  return {
    listModels: () => Promise.resolve({ models: [MODEL] }),
    isAuthenticationEnforced: () => Promise.resolve(true),
    embedText: () => Promise.reject(new Error("Embedding not used.")),
    inferStructured: <Output>(request: StructuredInferenceRequest<Output>) =>
      new Promise((_resolve, reject) => {
        if (request.signal?.aborted === true) {
          reject(new InferenceError("inference_cancelled", "Cancelled."));
          return;
        }
        request.signal?.addEventListener(
          "abort",
          () => {
            reject(new InferenceError("inference_cancelled", "Cancelled."));
          },
          { once: true },
        );
        onStarted();
      }),
  };
}

function safeCollector(
  input: CreateOutboundContextCollectorInput,
): Promise<OutboundContextCollector> {
  return createOutboundContextCollector({
    ...input,
    gitIgnorePolicy: { isIgnored: () => Promise.resolve(false) },
    projectIgnorePolicy: {
      excludes: () => false,
      ignored_negation_rules: 0,
    },
  });
}

function fakeRepoRead(files: Record<string, string>): RepositoryReadCapability {
  const byPath = new Map(Object.entries(files));
  const listingCache = new Map<
    string,
    {
      readonly entries: readonly {
        readonly path: string;
        readonly name: string;
        readonly kind: "file" | "directory";
      }[];
      readonly truncated: boolean;
    }
  >();

  function listing(directory: string) {
    const cached = listingCache.get(directory);
    if (cached !== undefined) return cached;
    const prefix = directory === "." ? "" : `${directory}/`;
    const seen = new Set<string>();
    const entries: {
      readonly path: string;
      readonly name: string;
      readonly kind: "file" | "directory";
    }[] = [];
    for (const filePath of Object.keys(files)) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (rest.length === 0) continue;
      const first = rest.split("/")[0];
      if (first === undefined || first.length === 0 || seen.has(first))
        continue;
      seen.add(first);
      const full = `${prefix}${first}`;
      entries.push({
        path: full,
        name: first,
        kind: byPath.has(full) ? "file" : "directory",
      });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const built = { entries, truncated: false };
    listingCache.set(directory, built);
    return built;
  }

  return {
    listDirectory: (input) => {
      const directory = input?.path ?? ".";
      if (byPath.has(directory)) {
        return Promise.reject(
          new RepositoryAccessError(
            "invalid_request",
            "list_directory",
            "Directory listing requires a directory.",
          ),
        );
      }
      return Promise.resolve(listing(directory));
    },
    searchText: () =>
      Promise.resolve({
        matches: [],
        visited_files: 0,
        scanned_bytes: 0,
        truncated: false,
      }),
    readSnippet: (input) => {
      const content = byPath.get(input.path);
      if (content === undefined) {
        return Promise.reject(
          new RepositoryAccessError(
            "repository_not_found",
            "read_snippet",
            "File not found.",
          ),
        );
      }
      const lines = content.split("\n");
      const start = input.start_line ?? 1;
      const count = input.line_count ?? 200;
      const selected = lines.slice(start - 1, start - 1 + count);
      return Promise.resolve({
        path: input.path,
        start_line: start,
        end_line: start + selected.length - 1,
        content: selected.join("\n"),
        truncated: start - 1 + selected.length < lines.length,
      });
    },
  };
}
