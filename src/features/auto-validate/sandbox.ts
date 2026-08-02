import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SANDBOX_CAPTURE_LIMIT_BYTES } from "./contracts.js";

const SANDBOX_PREFIX = "lmw-sandbox-";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  "node_modules",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".cache",
  ".next",
  ".turbo",
  "coverage",
  ".nyc_output",
  "htmlcov",
]);

const NETWORK_PROXY_VARIABLES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

const WINDOWS_COMMAND_SHIMS = new Map([
  ["npm", "npm.cmd"],
  ["npx", "npx.cmd"],
]);

export interface Sandbox {
  readonly root: string;
  dispose(): Promise<void>;
}

export interface CreateSandboxOptions {
  readonly sourceRoot: string;
  readonly temporaryRoot?: string;
}

export class SandboxError extends Error {
  public readonly code: "invalid_source" | "source_unavailable";

  public constructor(
    code: "invalid_source" | "source_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

export async function createSandbox(
  options: CreateSandboxOptions,
): Promise<Sandbox> {
  const sourceRoot = await realpath(options.sourceRoot);
  let stats;
  try {
    stats = await stat(sourceRoot);
  } catch {
    throw new SandboxError(
      "source_unavailable",
      "The repository root is unavailable.",
    );
  }
  if (!stats.isDirectory()) {
    throw new SandboxError(
      "invalid_source",
      "The repository root is not a directory.",
    );
  }
  const root = await mkdtemp(
    path.join(options.temporaryRoot ?? os.tmpdir(), SANDBOX_PREFIX),
  );
  await cp(sourceRoot, root, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      if (relative.length === 0) {
        return true;
      }
      const segments = relative.split(path.sep);
      return !segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
    },
  });
  return {
    root,
    dispose: () => rm(root, { recursive: true, force: true, maxRetries: 3 }),
  };
}

export interface DetectedTestCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export async function detectTestCommand(
  sandboxRoot: string,
): Promise<DetectedTestCommand | undefined> {
  let names: string[];
  try {
    names = await readdir(sandboxRoot);
  } catch {
    return undefined;
  }
  const present = new Set(names);
  const testDirectories = names.filter((name) =>
    ["test", "tests", "__tests__", "spec", "specs"].includes(
      name.toLowerCase(),
    ),
  );
  if (present.has("package.json")) {
    return { command: "npm", args: ["test"] };
  }
  if (
    testDirectories.length > 0 &&
    ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini"].some((name) =>
      present.has(name),
    )
  ) {
    return { command: "python", args: ["-m", "pytest"] };
  }
  return undefined;
}

export interface SandboxProcessRun {
  readonly exit_code: number | null;
  readonly signal_code: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdout_truncated: boolean;
  readonly stderr_truncated: boolean;
  readonly timed_out: boolean;
  readonly error: string | null;
  readonly duration_ms: number;
}

export interface RunSandboxProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
  readonly capture_limit?: number;
}

export function runSandboxProcess(
  options: RunSandboxProcessOptions,
): Promise<SandboxProcessRun> {
  return new Promise<SandboxProcessRun>((resolve, reject) => {
    const startedAt = Date.now();
    const captureLimit = options.capture_limit ?? SANDBOX_CAPTURE_LIMIT_BYTES;
    const command = resolvedCommand(options.command);
    const child = spawn(command, [...options.args], {
      cwd: options.cwd,
      env: sandboxEnvironment(),
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const onStdout = (chunk: Buffer): void => {
      if (stdout.length >= captureLimit) {
        stdoutTruncated = true;
        return;
      }
      stdout += chunk.toString("utf8").slice(0, captureLimit - stdout.length);
      if (stdout.length >= captureLimit) {
        stdoutTruncated = true;
      }
    };
    const onStderr = (chunk: Buffer): void => {
      if (stderr.length >= captureLimit) {
        stderrTruncated = true;
        return;
      }
      stderr += chunk.toString("utf8").slice(0, captureLimit - stderr.length);
      if (stderr.length >= captureLimit) {
        stderrTruncated = true;
      }
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, options.timeout_ms);

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const rejectAborted = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        new DOMException("The auto-validate task was aborted.", "AbortError"),
      );
    };
    const onAbort = (): void => {
      terminate(child);
      rejectAborted();
    };
    if (options.signal?.aborted === true) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exit_code: null,
        signal_code: null,
        stdout,
        stderr,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
        timed_out: false,
        error: error.message,
        duration_ms: Date.now() - startedAt,
      });
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exit_code: timedOut ? null : code,
        signal_code: timedOut ? null : (signal ?? null),
        stdout,
        stderr,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
        timed_out: timedOut,
        error: null,
        duration_ms: Date.now() - startedAt,
      });
    });
  });
}

export function splitCommand(command: string): readonly string[] {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(trimmed)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function resolvedCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  return WINDOWS_COMMAND_SHIMS.get(command) ?? command;
}

function sandboxEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of NETWORK_PROXY_VARIABLES) {
    delete environment[name];
  }
  return environment;
}

function terminate(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to terminating only the direct child.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The child already exited.
  }
}
