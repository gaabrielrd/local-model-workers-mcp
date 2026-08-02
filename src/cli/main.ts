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

  writeDiagnostic(`Unknown option: ${arguments_.join(" ")}\n`);
  return 64;
}
