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
} from "./harnesses.js";
import type { InstallationCommandIo } from "./cli.js";
import { getEffectiveConfiguration } from "../configuration/index.js";

export async function runInteractiveSetup(
  optionsMap: ReadonlyMap<string, string | true>,
  io: InstallationCommandIo,
  readlineInterface?: readline.Interface,
): Promise<number> {
  const isNonInteractive =
    optionsMap.has("non-interactive") ||
    optionsMap.has("yes") ||
    !process.stdin.isTTY;

  let rl: readline.Interface | undefined = readlineInterface;
  const shouldCloseRl = rl === undefined && !isNonInteractive;

  if (shouldCloseRl) {
    rl = readline.createInterface({
      input: process.stdin,
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

    // 5. Target Harness
    let target = stringOpt(optionsMap, "target");
    if (target === undefined && !isNonInteractive && rl) {
      const promptText = `Target harness (claude-code / codex / antigravity / all / cancel) [all]: `;
      const answer = (await rl.question(promptText)).trim().toLowerCase();
      if (
        answer === "claude-code" ||
        answer === "codex" ||
        answer === "antigravity" ||
        answer === "all" ||
        answer === "both" ||
        answer === "cancel"
      ) {
        target = answer;
      } else if (answer === "") {
        target = "all";
      } else {
        io.write("Invalid harness choice. Aborting setup.\n");
        return 65;
      }
    } else if (target === undefined) {
      target = "all";
    }

    if (target === "cancel") {
      io.write("Setup cancelled.\n");
      return 0;
    }

    if (
      target !== "claude-code" &&
      target !== "codex" &&
      target !== "antigravity" &&
      target !== "all" &&
      target !== "both"
    ) {
      io.write(`Invalid target harness: ${target}\n`);
      return 65;
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
      selection: target,
      projectRoot: projRoot,
      homeDirectory: homeDir,
    });

    for (const proposal of harnessProposals) {
      io.write(
        `${proposal.harness}: ${proposal.state} -> ${proposal.target_path}\n`,
      );
      for (const line of proposal.preview) {
        io.write(`  ${line}\n`);
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
    if (target === "claude-code" || target === "all" || target === "both") {
      io.write(
        "  - For Claude Code: run 'claude' in this repository directory.\n",
      );
    }
    if (target === "codex" || target === "all" || target === "both") {
      io.write("  - For Codex: run 'codex' from any shell.\n");
    }
    if (target === "antigravity" || target === "all" || target === "both") {
      io.write(
        "  - For Antigravity: server registered in ~/.gemini/config/mcp_config.json.\n",
      );
    }
    io.write("\nMake sure your shell exports the environment variables:\n");
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
