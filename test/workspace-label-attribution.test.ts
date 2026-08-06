import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getEffectiveConfiguration,
  PreferencesSchema,
  resolveGlobalPreferencesPath,
  resolveProjectPreferencesPath,
  validateConfig,
} from "../src/features/configuration/index.js";
import { createLmStudioClient } from "../src/features/model-inference/lm-studio.js";
import { createOllamaAdapter } from "../src/features/model-inference/ollama.js";

void describe("Workspace-label attribution (Task 065 / R6)", () => {
  const testProvidersEnv = JSON.stringify([
    {
      name: "primary",
      type: "lm-studio",
      base_url: "http://127.0.0.1:1234",
      allowed_models: ["*"],
      priority: 1,
    },
  ]);

  void it("parses workspace_label in PreferencesSchema", () => {
    const parsed = PreferencesSchema.parse({
      schema_version: 1,
      workspace_label: "team-frontend-mcp",
    });
    assert.equal(parsed.workspace_label, "team-frontend-mcp");
  });

  void it("resolves workspace_label from global and project preferences with origin tracking", async () => {
    const globalPath = resolveGlobalPreferencesPath({
      homeDirectory: "/global",
      platform: "darwin",
      environment: {},
    });
    const projectPath = resolveProjectPreferencesPath("/project");

    const memoryFs = new Map<string, string>([
      [
        globalPath,
        JSON.stringify({
          schema_version: 1,
          default_model: "qwen2.5-coder-7b",
          workspace_label: "global-org-label",
        }),
      ],
      [
        projectPath,
        JSON.stringify({
          schema_version: 1,
          workspace_label: "project-override-label",
        }),
      ],
    ]);

    const mockFileSystem = {
      readFile: async (path: string) => {
        const content = memoryFs.get(path);
        if (content === undefined) throw new Error("File not found");
        return Promise.resolve(content);
      },
      writeFile: async () => Promise.resolve(),
      stat: async (path: string) =>
        Promise.resolve({
          isDirectory: () =>
            path === "/project" ||
            path === "/global" ||
            path.startsWith("/project/") ||
            path.startsWith("/global/"),
          isFile: () => memoryFs.has(path),
        }),
      realpath: async (path: string) => Promise.resolve(path),
    };

    const globalConfig = await getEffectiveConfiguration({
      homeDirectory: "/global",
      platform: "darwin",
      environment: {
        LMW_PROVIDERS: testProvidersEnv,
      },
      fileSystem: mockFileSystem,
    });

    assert.equal(globalConfig.workspace_label, "global-org-label");
    assert.equal(globalConfig.origins.workspace_label, "global");

    const projectConfig = await getEffectiveConfiguration({
      homeDirectory: "/global",
      projectRoot: "/project",
      platform: "darwin",
      environment: {
        LMW_PROVIDERS: testProvidersEnv,
      },
      fileSystem: mockFileSystem,
    });

    assert.equal(projectConfig.workspace_label, "project-override-label");
    assert.equal(projectConfig.origins.workspace_label, "project");
  });

  void it("supports workspace_label mutations via validateConfig", async () => {
    const projectPath = resolveProjectPreferencesPath("/project");
    const globalPath = resolveGlobalPreferencesPath({
      homeDirectory: "/global",
      platform: "darwin",
      environment: {},
    });

    const memoryFs = new Map<string, string>([
      [
        globalPath,
        JSON.stringify({
          schema_version: 1,
          default_model: "qwen2.5-coder-7b",
        }),
      ],
      [
        projectPath,
        JSON.stringify({
          schema_version: 1,
          default_model: "qwen2.5-coder-7b",
        }),
      ],
    ]);

    const mockFileSystem = {
      readFile: async (path: string) => {
        const content = memoryFs.get(path);
        if (content === undefined) throw new Error("File not found");
        return Promise.resolve(content);
      },
      writeFile: async (path: string, data: string) => {
        memoryFs.set(path, data);
        return Promise.resolve();
      },
      stat: async (path: string) =>
        Promise.resolve({
          isDirectory: () =>
            path === "/project" ||
            path === "/global" ||
            path.startsWith("/project/") ||
            path.startsWith("/global/"),
          isFile: () => memoryFs.has(path),
        }),
      realpath: async (path: string) => Promise.resolve(path),
    };

    const currentConfig = await getEffectiveConfiguration({
      homeDirectory: "/global",
      projectRoot: "/project",
      platform: "darwin",
      environment: {
        LMW_PROVIDERS: testProvidersEnv,
      },
      fileSystem: mockFileSystem,
    });

    const proposal = await validateConfig({
      homeDirectory: "/global",
      projectRoot: "/project",
      expected_revision: currentConfig.revision,
      platform: "darwin",
      environment: {
        LMW_PROVIDERS: testProvidersEnv,
      },
      changes: {
        workspace_label: "dev-cluster-node-1",
      },
      fileSystem: mockFileSystem,
    });

    assert.equal(proposal.valid, true, JSON.stringify(proposal));
    if (proposal.valid) {
      assert.equal(
        proposal.changes.find((c) => c.field === "workspace_label")?.new_value,
        "dev-cluster-node-1",
      );
    }
  });

  void it("attaches X-Workspace-Label header to LM Studio HTTP requests when configured", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (init?.headers) {
        capturedHeaders = Object.fromEntries(
          Object.entries(init.headers as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: "qwen2.5-coder-7b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      allowedModels: ["*"],
      workspaceLabel: "billing-service-worker",
      fetch: mockFetch,
    });

    await client.listModels({ timeout_ms: 5000 });

    assert.equal(
      capturedHeaders["x-workspace-label"],
      "billing-service-worker",
    );
  });

  void it("attaches X-Workspace-Label header to Ollama HTTP requests when configured", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (init?.headers) {
        capturedHeaders = Object.fromEntries(
          Object.entries(init.headers as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            models: [{ name: "llama3:latest" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const adapter = createOllamaAdapter({
      configuration: {
        name: "ollama-local",
        type: "ollama",
        base_url: "http://127.0.0.1:11434",
        allowed_models: ["*"],
        priority: 1,
      },
      workspaceLabel: "analytics-worker-2",
      fetch: mockFetch,
    });

    await adapter.listModels({ timeout_ms: 5000 });

    assert.equal(capturedHeaders["x-workspace-label"], "analytics-worker-2");
  });

  void it("omits X-Workspace-Label header when workspaceLabel is unset", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (init?.headers) {
        capturedHeaders = Object.fromEntries(
          Object.entries(init.headers as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: "qwen2.5-coder-7b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      allowedModels: ["*"],
      fetch: mockFetch,
    });

    await client.listModels({ timeout_ms: 5000 });

    assert.equal(capturedHeaders["x-workspace-label"], undefined);
  });
});
