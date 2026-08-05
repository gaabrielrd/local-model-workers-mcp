import process from "node:process";

import {
  createTheme,
  detectCapabilities,
  renderBanner,
  type Theme,
} from "../features/installation/index.js";
import { PACKAGE_INFO } from "../shared/package-info.js";

export type DiagnosticWriter = (message: string) => void;

export interface RunCliOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stream?: { readonly isTTY?: boolean; readonly columns?: number };
  readonly platform?: NodeJS.Platform;
}

interface CommandEntry {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly summary: string;
}

const COMMANDS: readonly CommandEntry[] = [
  {
    name: "setup",
    aliases: ["init", "quickstart"],
    summary:
      "Guided setup: provider, models, features, harnesses, health check",
  },
  {
    name: "configure-harness",
    summary: "Register the server with a specific coding harness",
  },
  {
    name: "configure-global",
    summary: "Write global preferences (default model, feature groups)",
  },
];

const OPTIONS: readonly CommandEntry[] = [
  { name: "--version, -v", summary: "Print the installed version" },
  { name: "--help, -h", summary: "Show this help" },
];

export function runCli(
  arguments_: readonly string[],
  writeDiagnostic: DiagnosticWriter,
  options: RunCliOptions = {},
): number {
  if (arguments_.length === 0) {
    return 0;
  }

  const theme = createTheme(
    detectCapabilities({
      environment: options.environment ?? process.env,
      stream: options.stream ?? process.stderr,
      platform: options.platform ?? process.platform,
    }),
  );

  if (
    arguments_.length === 1 &&
    (arguments_[0] === "--version" || arguments_[0] === "-v")
  ) {
    writeDiagnostic(`${PACKAGE_INFO.name} ${PACKAGE_INFO.version}\n`);
    return 0;
  }

  if (
    arguments_.length === 1 &&
    (arguments_[0] === "--help" || arguments_[0] === "-h")
  ) {
    writeDiagnostic(renderHelp(theme));
    return 0;
  }

  writeDiagnostic(
    `${theme.status("failure", `Unknown option: ${arguments_.join(" ")}`)}\n` +
      `${theme.muted(`Run ${PACKAGE_INFO.name} --help to see available commands.`)}\n`,
  );
  return 64;
}

function renderHelp(theme: Theme): string {
  const width = Math.max(
    ...[...COMMANDS, ...OPTIONS].map((entry) => entry.name.length),
  );

  const lines: string[] = [renderBanner({ theme })];

  lines.push(
    `${theme.bold("USAGE")}\n  ${theme.accent(PACKAGE_INFO.name)} ${theme.muted("[command] [options]")}\n`,
  );
  lines.push(
    `  ${theme.muted("Started with no arguments, the binary serves MCP over stdio.")}\n\n`,
  );

  lines.push(`${theme.bold("COMMANDS")}\n`);
  for (const command of COMMANDS) {
    const alias =
      command.aliases === undefined
        ? ""
        : theme.muted(`  (aliases: ${command.aliases.join(", ")})`);
    lines.push(
      `  ${theme.accent(command.name.padEnd(width))}  ${command.summary}${alias}\n`,
    );
  }

  lines.push(`\n${theme.bold("OPTIONS")}\n`);
  for (const option of OPTIONS) {
    lines.push(
      `  ${theme.accent(option.name.padEnd(width))}  ${option.summary}\n`,
    );
  }

  lines.push(
    `\n${theme.bold("GET STARTED")}\n  ${theme.muted(theme.glyphs.arrow)} ${theme.accent(`${PACKAGE_INFO.name} setup`)}\n`,
  );

  return lines.join("");
}
