import {
  runSandboxProcess,
  type DetectedTestCommand,
  type RunSandboxProcessOptions,
  type SandboxProcessRun,
} from "./sandbox.js";

export interface CoverageMeasurement {
  readonly line_coverage_percent: number;
}

export interface MeasureCoverageOptions {
  readonly sandboxRoot: string;
  readonly testCommand: DetectedTestCommand;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal | undefined;
  readonly commandRunner?:
    | ((options: RunSandboxProcessOptions) => Promise<SandboxProcessRun>)
    | undefined;
}

const ISTANBUL_TABLE_PATTERN =
  /All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/u;
const ISTANBUL_SUMMARY_PATTERN = /Lines\s*:\s*([\d.]+)%/u;
const PYTEST_COV_PATTERN = /^TOTAL\s+\d+\s+\d+\s+(\d+)%/mu;
const GO_TEST_PATTERN = /coverage:\s*([\d.]+)%\s+of statements/u;

export function deriveCoverageCommand(
  testCommand: DetectedTestCommand,
): DetectedTestCommand {
  const { command, args } = testCommand;
  if (command === "npm" && args.includes("test") && !args.includes("--")) {
    return { command, args: [...args, "--", "--coverage"] };
  }
  if (
    (command === "python" || command === "python3") &&
    args.some((arg) => arg === "pytest") &&
    !args.some((arg) => arg.startsWith("--cov"))
  ) {
    return { command, args: [...args, "--cov"] };
  }
  if (
    command === "go" &&
    args.includes("test") &&
    !args.some((arg) => arg.startsWith("-cover"))
  ) {
    return { command, args: [...args, "-cover"] };
  }
  return testCommand;
}

export function parseCoverageSummary(output: string): number | undefined {
  const patterns = [
    ISTANBUL_TABLE_PATTERN,
    ISTANBUL_SUMMARY_PATTERN,
    PYTEST_COV_PATTERN,
    GO_TEST_PATTERN,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[1] !== undefined) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 100) {
        return value;
      }
    }
  }
  return undefined;
}

export async function measureCoverage(
  options: MeasureCoverageOptions,
): Promise<CoverageMeasurement | undefined> {
  const runner = options.commandRunner ?? runSandboxProcess;
  const coverageCommand = deriveCoverageCommand(options.testCommand);
  try {
    const run = await runner({
      command: coverageCommand.command,
      args: [...coverageCommand.args],
      cwd: options.sandboxRoot,
      timeout_ms: options.timeout_ms,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const percent = parseCoverageSummary(`${run.stdout}\n${run.stderr}`);
    if (percent === undefined) {
      return undefined;
    }
    return { line_coverage_percent: percent };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return undefined;
  }
}
