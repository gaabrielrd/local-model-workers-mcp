import os from "node:os";
import process from "node:process";
import readline from "node:readline/promises";

import { checkHealth } from "../health/index.js";
import { createLmStudioClient } from "../model-inference/index.js";
import {
  applyGlobalPreferences,
  proposeGlobalPreferences,
} from "./global-preferences.js";
import {
  applyHarnessConfiguration,
  proposeHarnessConfigurations,
  type Harness,
} from "./harnesses.js";
import { selectOptions } from "./select-options.js";
import type { InstallationCommandIo } from "./cli.js";
import {
  FEATURE_GROUPS,
  getEffectiveConfiguration,
  type FeatureGroup,
} from "../configuration/index.js";

export async function runInteractiveSetup(
  optionsMap: ReadonlyMap<string, string | true>,
  io: InstallationCommandIo,
  readlineInterface?: readline.Interface,
  input?: NodeJS.ReadableStream,
): Promise<number> {
  const inputStream = (input ?? process.stdin) as NodeJS.ReadableStream & {
    isTTY?: boolean;
  };
  const isNonInteractive =
    optionsMap.has("non-interactive") ||
    optionsMap.has("yes") ||
    inputStream.isTTY !== true;

  let rl: readline.Interface | undefined = readlineInterface;
  const shouldCloseRl = rl === undefined && !isNonInteractive;

  if (shouldCloseRl) {
    rl = readline.createInterface({
      input: inputStream,
      output: process.stderr,
    });
  }

  try {
    io.write("--- Local Model Workers MCP Setup ---\n\n");

    const env = io.environment ?? process.env;
    const homeDir =
      stringOpt(optionsMap, "home") ?? io.homeDirectory ?? os.homedir();
    const projRoot =
      stringOpt(optionsMap, "project-root") ?? io.cwd ?? process.cwd();
    const dryRun = optionsMap.has("dry-run");
    const autoConfirm = optionsMap.has("yes") || isNonInteractive;

    // 1. Connection / LM Studio Base URL
    const envUrl = env.LMW_LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";
    let baseUrl =
      stringOpt(optionsMap, "url") ?? stringOpt(optionsMap, "base-url");

    if (baseUrl === undefined && !isNonInteractive && rl) {
      const promptText = `LM Studio Base URL [${envUrl}]: `;
      const answer = (await rl.question(promptText)).trim();
      baseUrl = answer.length > 0 ? answer : envUrl;
    } else if (baseUrl === undefined) {
      baseUrl = envUrl;
    }

    // Optional Bearer Token (needed before model list probe if required)
    const envToken = env.LMW_LM_STUDIO_BEARER_TOKEN ?? "";
    let bearerToken =
      stringOpt(optionsMap, "token") ?? stringOpt(optionsMap, "bearer-token");
    if (bearerToken === undefined && !isNonInteractive && rl) {
      const promptText = `LM Studio Bearer Token (leave empty for none): `;
      const answer = (await rl.question(promptText)).trim();
      bearerToken =
        answer.length > 0 ? answer : envToken.length > 0 ? envToken : undefined;
    } else if (bearerToken === undefined) {
      bearerToken = envToken.length > 0 ? envToken : undefined;
    }

    // 2. Allowed Models (Auto-populated if omitted)
    const envModelsRaw = env.LMW_ALLOWED_MODELS;
    let envModelsDefault: string[] | undefined;
    if (envModelsRaw) {
      try {
        const parsed: unknown = JSON.parse(envModelsRaw);
        if (
          Array.isArray(parsed) &&
          parsed.every((item): item is string => typeof item === "string")
        ) {
          envModelsDefault = parsed;
        }
      } catch {
        // fallback
      }
    }

    const rawModelsOpt =
      stringOpt(optionsMap, "allowed-models") ??
      stringOpt(optionsMap, "models");
    let allowedModels: string[] | undefined;

    if (rawModelsOpt !== undefined) {
      allowedModels = rawModelsOpt
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
    } else if (envModelsDefault !== undefined && envModelsDefault.length > 0) {
      allowedModels = envModelsDefault;
    } else if (!isNonInteractive && rl) {
      const promptText = `Allowed models (comma-separated, press enter to auto-detect from LM Studio API): `;
      const answer = (await rl.question(promptText)).trim();
      if (answer.length > 0) {
        allowedModels = answer
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.length > 0);
      }
    }

    if (allowedModels === undefined || allowedModels.length === 0) {
      io.write(
        "Auto-detecting available models from LM Studio API (/v1/models)...\n",
      );
      try {
        const client = createLmStudioClient({
          baseUrl,
          allowedModels: ["*"],
          ...(bearerToken ? { bearerToken } : {}),
        });
        const catalog = await client.listModels({ timeout_ms: 5000 });
        if (catalog.models.length > 0) {
          allowedModels = [...catalog.models];
          io.write(
            `Auto-populated ${allowedModels.length} model(s) from LM Studio: ${allowedModels.join(", ")}\n`,
          );
        }
      } catch {
        io.write(
          "Could not reach LM Studio API to auto-detect models; allowing all models.\n",
        );
      }
    }

    if (allowedModels === undefined || allowedModels.length === 0) {
      allowedModels = ["*"];
    }

    // 3. Default Model
    const envDefaultModel = allowedModels[0] ?? "qwen/qwen3.5-9b";
    let defaultModel = stringOpt(optionsMap, "default-model");
    if (defaultModel === undefined && !isNonInteractive && rl) {
      const promptText = `Default Model [${envDefaultModel}]: `;
      const answer = (await rl.question(promptText)).trim();
      defaultModel = answer.length > 0 ? answer : envDefaultModel;
    } else if (defaultModel === undefined) {
      defaultModel = envDefaultModel;
    }

    if (!allowedModels.includes(defaultModel)) {
      allowedModels.unshift(defaultModel);
    }

    // 4. MCP feature groups
    let enabledFeatures: readonly FeatureGroup[];
    const featuresFlag = stringOpt(optionsMap, "features");
    if (featuresFlag !== undefined) {
      const parsedFeatures = parseFeatureSelection(featuresFlag);
      if (parsedFeatures === undefined) {
        io.write("Invalid feature selection. Aborting setup.\n");
        return 65;
      }
      enabledFeatures = parsedFeatures;
    } else if (!isNonInteractive && rl) {
      const selection = await selectOptions({
        prompt: "Select MCP features (space to toggle, enter to confirm):",
        options: [
          {
            label: "Repository exploration and code search",
            value: "exploration",
          },
          { label: "Test generation and auto-validation", value: "tests" },
          { label: "Documentation generation", value: "docs" },
          { label: "Lint fixes", value: "lint" },
        ],
        initial: FEATURE_GROUPS,
        write: io.write,
        input: inputStream,
      });
      if (selection.cancelled || selection.values.length === 0) {
        io.write("Setup cancelled.\n");
        return 0;
      }
      enabledFeatures = selection.values as readonly FeatureGroup[];
    } else {
      enabledFeatures = FEATURE_GROUPS;
    }

    // 5. Target Harness(es)
    let targets: readonly Harness[];
    const targetFlag = stringOpt(optionsMap, "target");
    if (targetFlag !== undefined) {
      if (!isHarnessSelection(targetFlag)) {
        io.write("Invalid harness choice. Aborting setup.\n");
        return 65;
      }
      targets = harnessesFromSelection(targetFlag);
      if (targets.length === 0) {
        io.write("Setup cancelled.\n");
        return 0;
      }
    } else if (!isNonInteractive && rl) {
      const selection = await selectOptions({
        prompt: "Select target harnesses (space to toggle, enter to confirm):",
        options: [
          {
            label:
              "Claude Code Global (~/.claude.json — active in all projects)",
            value: "claude-code",
          },
          {
            label: "Codex Global (~/.codex/config.toml)",
            value: "codex",
          },
          {
            label: "Antigravity Global (~/.gemini/config/mcp_config.json)",
            value: "antigravity",
          },
          {
            label: "Cursor (~/.cursor/mcp.json or .cursor/mcp.json)",
            value: "cursor",
          },
          {
            label:
              "VS Code / Roo Code / Cline (~/.vscode/mcp.json or .vscode/mcp.json)",
            value: "vscode",
          },
          {
            label: "Neovim / Avante (~/.config/nvim/mcp.json)",
            value: "neovim",
          },
          {
            label:
              "JetBrains IDE Suite (IntelliJ IDEA, PyCharm, WebStorm, GoLand, CLion)",
            value: "jetbrains",
          },
          {
            label: "Claude Code Project Local (.mcp.json)",
            value: "claude-code-project",
          },
        ],
        initial: ["claude-code", "codex", "antigravity"],
        write: io.write,
        input: inputStream,
      });
      if (selection.cancelled || selection.values.length === 0) {
        io.write("Setup cancelled.\n");
        return 0;
      }
      targets = selection.values as readonly Harness[];
    } else {
      targets = ["claude-code", "codex", "antigravity"];
    }

    // Build environment object for runtime setup
    const effectiveEnv: Record<string, string> = {
      ...(env as Record<string, string>),
      LMW_LM_STUDIO_BASE_URL: baseUrl,
      LMW_ALLOWED_MODELS: JSON.stringify(allowedModels),
    };
    if (bearerToken) {
      effectiveEnv.LMW_LM_STUDIO_BEARER_TOKEN = bearerToken;
    } else {
      delete effectiveEnv.LMW_LM_STUDIO_BEARER_TOKEN;
    }

    io.write("\nProposing configuration changes...\n");

    // Propose Global Preferences
    const globalProposal = await proposeGlobalPreferences({
      preferences: {
        schema_version: 1,
        default_model: defaultModel,
        enabled_features: enabledFeatures,
      },
      environment: effectiveEnv,
      platform: io.platform ?? process.platform,
      homeDirectory: homeDir,
    });

    io.write(
      `global: ${globalProposal.state} -> ${globalProposal.target_path}\n`,
    );
    for (const line of globalProposal.preview) {
      io.write(`  ${line}\n`);
    }

    if (!globalProposal.applicable) {
      io.write(
        "Global preferences state is invalid; manual repair required.\n",
      );
      return 65;
    }

    // Propose Harness Configurations
    const harnessProposals = await proposeHarnessConfigurations({
      selection: targets,
      projectRoot: projRoot,
      homeDirectory: homeDir,
      environment: effectiveEnv,
      platform: io.platform ?? process.platform,
      enabledFeatures,
    });

    for (const proposal of harnessProposals) {
      io.write(
        `${proposal.harness}: ${proposal.state} -> ${proposal.target_path}\n`,
      );
      for (const line of proposal.preview) {
        io.write(`  ${line}\n`);
      }
      for (const warning of proposal.warnings) {
        io.write(`  warning: ${warning}\n`);
      }
    }

    if (harnessProposals.some((p) => !p.applicable)) {
      io.write("One or more harness configurations require manual repair.\n");
      return 65;
    }

    if (dryRun) {
      io.write("\n[Dry Run] No files were modified.\n");
      return 0;
    }

    if (!autoConfirm && !isNonInteractive && rl) {
      const confirmText = "\nApply these changes? (y/N): ";
      const answer = (await rl.question(confirmText)).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        io.write("Setup cancelled by user.\n");
        return 0;
      }
    }

    // Apply Global Preferences
    const globalResult = await applyGlobalPreferences({
      proposal: globalProposal,
      ...(globalProposal.requires_confirmation
        ? {
            confirmation: {
              approved: true,
              proposal_id: globalProposal.proposal_id,
            },
          }
        : {}),
      environment: effectiveEnv,
      platform: io.platform ?? process.platform,
      homeDirectory: homeDir,
    });
    io.write(`global: ${globalResult.outcome}\n`);

    // Apply Harness Configurations
    for (const proposal of harnessProposals) {
      const result = await applyHarnessConfiguration({
        proposal,
        ...(proposal.requires_confirmation
          ? {
              confirmation: {
                approved: true,
                proposal_id: proposal.proposal_id,
              },
            }
          : {}),
        environment: effectiveEnv,
      });
      io.write(`${result.harness}: ${result.outcome}\n`);
    }

    // Diagnostics / Health Check
    io.write("\nRunning health diagnostics against LM Studio...\n");
    const healthResult = await checkHealth({
      loadConfiguration: async () => {
        const effective = await getEffectiveConfiguration({
          environment: effectiveEnv,
          platform: io.platform ?? process.platform,
          homeDirectory: homeDir,
        });
        return {
          effective,
          ...(bearerToken ? { bearer_token: bearerToken } : {}),
        };
      },
    });

    io.write(`Health status: ${healthResult.status.toUpperCase()}\n`);
    io.write(
      `  LM Studio Reachability: ${healthResult.reachability.status} (${healthResult.reachability.code})\n`,
    );
    io.write(
      `  Authentication: ${healthResult.authentication.status} (${healthResult.authentication.code})\n`,
    );
    if (healthResult.default_model) {
      io.write(
        `  Default Model (${healthResult.default_model.model}): ${healthResult.default_model.status} (${healthResult.default_model.code})\n`,
      );
    }

    io.write("\n--- Setup Complete! ---\n");
    io.write("You can now start your harness:\n");
    if (targets.includes("claude-code")) {
      io.write(
        "  - For Claude Code: run 'claude' in this repository directory.\n",
      );
    }
    if (targets.includes("codex")) {
      io.write("  - For Codex: run 'codex' from any shell.\n");
    }
    if (targets.includes("antigravity")) {
      io.write(
        "  - For Antigravity: server registered in ~/.gemini/config/mcp_config.json.\n",
      );
    }
    if (targets.includes("jetbrains")) {
      io.write(
        "  - For JetBrains IDEs: restart the IDE; AI Assistant reads the shared mcp.json on startup.\n",
      );
      io.write(
        "  - Register the steering rules file in Settings > Tools > AI Assistant > Rules.\n",
      );
    }
    io.write("\nMake sure your shell exports the environment variables:\n");
    io.write(`  Enabled MCP features: ${enabledFeatures.join(", ")}\n`);
    io.write(`  export LMW_LM_STUDIO_BASE_URL='${baseUrl}'\n`);
    io.write(
      `  export LMW_ALLOWED_MODELS='${JSON.stringify(allowedModels)}'\n`,
    );
    if (bearerToken) {
      io.write(`  export LMW_LM_STUDIO_BEARER_TOKEN='${bearerToken}'\n`);
    }

    return 0;
  } finally {
    if (shouldCloseRl && rl) {
      rl.close();
    }
  }
}

function stringOpt(
  options: ReadonlyMap<string, string | true>,
  name: string,
): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function isHarnessSelection(value: string): boolean {
  return (
    value === "claude-code" ||
    value === "claude-code-global" ||
    value === "claude-code-project" ||
    value === "codex" ||
    value === "antigravity" ||
    value === "cursor" ||
    value === "vscode" ||
    value === "neovim" ||
    value === "jetbrains" ||
    value === "all" ||
    value === "both" ||
    value === "cancel"
  );
}

function harnessesFromSelection(selection: string): readonly Harness[] {
  if (selection === "cancel") {
    return [];
  }
  if (selection === "claude-code-global") {
    return ["claude-code"];
  }
  if (selection === "all") {
    return ["claude-code", "codex", "antigravity", "jetbrains"];
  }
  if (selection === "both") {
    return ["claude-code", "codex"];
  }
  return [selection as Harness];
}

function parseFeatureSelection(
  value: string,
): readonly FeatureGroup[] | undefined {
  if (value.trim() === "all") {
    return FEATURE_GROUPS;
  }
  const selected = value
    .split(",")
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0);
  if (
    selected.length === 0 ||
    new Set(selected).size !== selected.length ||
    !selected.every((feature) =>
      FEATURE_GROUPS.includes(feature as FeatureGroup),
    )
  ) {
    return undefined;
  }
  return selected as readonly FeatureGroup[];
}
