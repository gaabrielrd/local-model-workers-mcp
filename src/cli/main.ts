import { PACKAGE_INFO } from "../shared/package-info.js";

export type DiagnosticWriter = (message: string) => void;

export function runCli(
  arguments_: readonly string[],
  writeDiagnostic: DiagnosticWriter,
): number {
  if (arguments_.length === 0) {
    return 0;
  }

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
    writeDiagnostic(
      `Usage: ${PACKAGE_INFO.name} [command] [options]\n\n` +
        `Commands:\n` +
        `  setup, init, quickstart   Interactive single-command setup, configuration, and health check\n` +
        `  configure-harness        Configure Claude Code or Codex harness files\n` +
        `  configure-global         Configure global preferences\n\n` +
        `Options:\n` +
        `  --version, -v            Show version\n` +
        `  --help, -h               Show help\n`,
    );
    return 0;
  }

  writeDiagnostic(`Unknown option: ${arguments_.join(" ")}\n`);
  return 64;
}
