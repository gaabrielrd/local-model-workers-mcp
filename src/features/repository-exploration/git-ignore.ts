import { execFile } from "node:child_process";

export interface GitIgnorePolicy {
  isIgnored(repositoryRelativePath: string): Promise<boolean>;
}

export interface GitCheckIgnoreRunner {
  check(repositoryRoot: string, repositoryRelativePath: string): Promise<0 | 1>;
}

export class GitIgnoreUnavailableError extends Error {
  public constructor() {
    super("Git ignore classification is unavailable.");
    this.name = "GitIgnoreUnavailableError";
  }
}

export function createGitIgnorePolicy(
  repositoryRoot: string,
  runner: GitCheckIgnoreRunner = nodeGitCheckIgnoreRunner,
): GitIgnorePolicy {
  return Object.freeze({
    async isIgnored(repositoryRelativePath: string): Promise<boolean> {
      let exitCode: 0 | 1;
      try {
        exitCode = await runner.check(repositoryRoot, repositoryRelativePath);
      } catch {
        throw new GitIgnoreUnavailableError();
      }
      return exitCode === 0;
    },
  });
}

const nodeGitCheckIgnoreRunner: GitCheckIgnoreRunner = {
  check: (repositoryRoot, repositoryRelativePath) =>
    new Promise<0 | 1>((resolve, reject) => {
      execFile(
        "git",
        [
          "-c",
          "core.quotepath=false",
          "check-ignore",
          "--quiet",
          "--no-index",
          "--",
          repositoryRelativePath,
        ],
        {
          cwd: repositoryRoot,
          env: safeGitEnvironment(),
          encoding: "utf8",
          windowsHide: true,
        },
        (error) => {
          if (error === null) {
            resolve(0);
            return;
          }
          if (isExitCode(error, 1)) {
            resolve(1);
            return;
          }
          reject(new GitIgnoreUnavailableError());
        },
      );
    }),
};

function safeGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    ...(process.env.SystemRoot === undefined
      ? {}
      : { SystemRoot: process.env.SystemRoot }),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    LC_ALL: "C",
  };
}

function isExitCode(error: Error, code: number): boolean {
  return "code" in error && error.code === code;
}
