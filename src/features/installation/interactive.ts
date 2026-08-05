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
import { renderBanner } from "./banner.js";
import { createTheme, detectCapabilities, startSpinner } from "./theme.js";
import {
  FEATURE_GROUPS,
  getEffectiveConfiguration,
  type FeatureGroup,
} from "../configuration/index.js";

const TOTAL_STEPS = 5;

/** Masks a secret so it can be echoed in guidance without leaking the value. */
function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "*".repeat(8);
  }
  return `${secret.slice(0, 2)}${"*".repeat(8)}${secret.slice(-2)}`;
}

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

  const theme = createTheme(
    detectCapabilities({
      environment: io.environment ?? process.env,
      stream: process.stderr,
      platform: io.platform ?? process.platform,
    }),
  );

  try {
    io.write(renderBanner({ theme, subtitle: "Setup" }));

    const env = io.environment ?? process.env;
    const homeDir =
      stringOpt(optionsMap, "home") ?? io.homeDirectory ?? os.homedir();
    const projRoot =
      stringOpt(optionsMap, "project-root") ?? io.cwd ?? process.cwd();
    const dryRun = optionsMap.has("dry-run");
    const autoConfirm = optionsMap.has("yes") || isNonInteractive;

    // 1. Connection / LM Studio Base URL
    io.write(theme.section(1, TOTAL_STEPS, "Provider connection"));
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
    io.write(theme.section(2, TOTAL_STEPS, "Model access"));
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
      const spinner = startSpinner({
        theme,
        write: io.write,
        label: `Probing ${baseUrl}/models for available models`,
      });
      try {
        const client = createLmStudioClient({
          baseUrl,
          allowedModels: ["*"],
          ...(bearerToken ? { bearerToken } : {}),
        });
        const catalog = await client.listModels({ timeout_ms: 5000 });
        if (catalog.models.length > 0) {
          allowedModels = [...catalog.models];
          spinner.stop(
            theme.status(
              "success",
              `Discovered ${theme.bold(String(allowedModels.length))} model(s)`,
            ),
          );
          for (const model of allowedModels) {
            io.write(`    ${theme.muted(theme.glyphs.bullet)} ${model}\n`);
          }
        } else {
          spinner.stop(
            theme.status("warning", "Provider returned an empty model catalog"),
          );
        }
      } catch {
        spinner.stop(
          theme.status(
            "warning",
            "Could not reach the provider; allowing all models",
          ),
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
    io.write(theme.section(3, TOTAL_STEPS, "Feature groups"));
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
    io.write(theme.section(4, TOTAL_STEPS, "Target harnesses"));
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

    io.write(theme.section(5, TOTAL_STEPS, "Planned changes"));

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
      `${theme.status("pending", theme.bold("global"))} ${theme.muted(globalProposal.state)} ${theme.muted(theme.glyphs.arrow)} ${globalProposal.target_path}\n`,
    );
    for (const line of globalProposal.preview) {
      io.write(`    ${theme.muted(line)}\n`);
    }

    if (!globalProposal.applicable) {
      io.write(
        `${theme.status("failure", "Global preferences state is invalid; manual repair required.")}\n`,
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
        `${theme.status("pending", theme.bold(proposal.harness))} ${theme.muted(proposal.state)} ${theme.muted(theme.glyphs.arrow)} ${proposal.target_path}\n`,
      );
      for (const line of proposal.preview) {
        io.write(`    ${theme.muted(line)}\n`);
      }
      for (const warning of proposal.warnings) {
        io.write(`    ${theme.status("warning", theme.warning(warning))}\n`);
      }
    }

    if (harnessProposals.some((p) => !p.applicable)) {
      io.write(
        `${theme.status("failure", "One or more harness configurations require manual repair.")}\n`,
      );
      return 65;
    }

    if (dryRun) {
      io.write(
        `\n${theme.box(
          [
            theme.status("success", "[Dry Run] No files were modified."),
            theme.muted("Re-run without --dry-run to apply these changes."),
          ],
          theme.accent("Preview"),
        )}\n`,
      );
      return 0;
    }

    if (!autoConfirm && !isNonInteractive && rl) {
      const confirmText = `\n${theme.accent(theme.glyphs.arrow)} Apply these changes? ${theme.muted("(y/N)")}: `;
      const answer = (await rl.question(confirmText)).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        io.write(`${theme.status("warning", "Setup cancelled by user.")}\n`);
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
    io.write(
      `${theme.status("success", theme.bold("global"))} ${theme.success(globalResult.outcome)}\n`,
    );

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
      io.write(
        `${theme.status("success", theme.bold(result.harness))} ${theme.success(result.outcome)}\n`,
      );
    }

    // Diagnostics / Health Check
    io.write("\n");
    const healthSpinner = startSpinner({
      theme,
      write: io.write,
      label: "Running health diagnostics against the provider",
    });
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

    const overall = healthResult.status.toUpperCase();
    healthSpinner.stop(
      theme.status(
        healthResult.status === "healthy" ? "success" : "failure",
        `Health status: ${theme.bold(overall)}`,
      ),
    );

    const probeLine = (
      label: string,
      probe: { readonly status: string; readonly code: string },
    ): string => {
      const kind =
        probe.status === "healthy"
          ? "success"
          : probe.status === "not_checked"
            ? "pending"
            : "failure";
      const padded = `${label}:`.padEnd(24);
      return `  ${theme.status(kind, `${padded} ${probe.status} ${theme.muted(`(${probe.code})`)}`)}\n`;
    };

    io.write(probeLine("Reachability", healthResult.reachability));
    io.write(probeLine("Authentication", healthResult.authentication));
    if (healthResult.default_model) {
      io.write(probeLine("Default model", healthResult.default_model));
      io.write(`    ${theme.muted(healthResult.default_model.model)}\n`);
    }

    // These lines are kept as contiguous plain text (no per-character
    // gradient) so they stay greppable by humans and scripts alike.
    io.write(
      `\n${theme.box(
        [
          theme.bold("Setup Complete"),
          "",
          `Provider:             ${baseUrl}`,
          `Default model:        ${defaultModel}`,
          `Enabled MCP features: ${enabledFeatures.join(", ")}`,
          `Harnesses:            ${targets.join(", ")}`,
        ],
        theme.accent("Ready"),
      )}\n`,
    );

    const nextSteps: string[] = [];
    if (targets.includes("claude-code")) {
      nextSteps.push(
        `Claude Code: run ${theme.accent("claude")} in this repository.`,
      );
    }
    if (targets.includes("codex")) {
      nextSteps.push(`Codex: run ${theme.accent("codex")} from any shell.`);
    }
    if (targets.includes("antigravity")) {
      nextSteps.push(
        "Antigravity: registered in ~/.gemini/config/mcp_config.json.",
      );
    }
    if (targets.includes("jetbrains")) {
      nextSteps.push(
        "JetBrains: restart the IDE; AI Assistant reads the shared mcp.json on startup.",
      );
      nextSteps.push(
        "JetBrains: register the steering rules in Settings > Tools > AI Assistant > Rules.",
      );
    }
    if (nextSteps.length > 0) {
      io.write(`\n${theme.bold("Start your harness")}\n`);
      for (const step of nextSteps) {
        io.write(`  ${theme.muted(theme.glyphs.bullet)} ${step}\n`);
      }
    }

    io.write(`\n${theme.bold("Export these in your shell")}\n`);
    io.write(
      `  ${theme.muted("export")} LMW_LM_STUDIO_BASE_URL=${theme.accent(`'${baseUrl}'`)}\n`,
    );
    io.write(
      `  ${theme.muted("export")} LMW_ALLOWED_MODELS=${theme.accent(`'${JSON.stringify(allowedModels)}'`)}\n`,
    );
    if (bearerToken) {
      // The value itself is never echoed; setup already persisted it.
      io.write(
        `  ${theme.muted("export")} LMW_LM_STUDIO_BEARER_TOKEN=${theme.muted(`'${maskSecret(bearerToken)}'`)} ${theme.muted("(value hidden)")}\n`,
      );
    }
    io.write("\n");

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
