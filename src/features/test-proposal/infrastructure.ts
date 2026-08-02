import type { RepositoryReadCapability } from "../repository-exploration/index.js";

export interface TestInfrastructure {
  readonly kind: "typescript" | "python";
  readonly config_files: readonly string[];
  readonly test_directories: readonly string[];
  readonly suggested_commands: readonly string[];
}

export async function detectTestInfrastructure(
  repository: RepositoryReadCapability,
): Promise<readonly TestInfrastructure[]> {
  const listing = await repository.listDirectory({ max_entries: 500 });
  const paths = new Set(
    listing.entries.map((entry) => entry.path.toLowerCase()),
  );
  const testDirectories = listing.entries
    .filter(
      (entry) =>
        entry.kind === "directory" &&
        ["test", "tests", "__tests__", "spec", "specs"].includes(
          entry.name.toLowerCase(),
        ),
    )
    .map((entry) => entry.path);
  const detected: TestInfrastructure[] = [];
  const tsConfigs = [
    "vitest.config.ts",
    "vitest.config.js",
    "jest.config.ts",
    "jest.config.js",
  ].filter((candidate) => paths.has(candidate));
  if (
    paths.has("package.json") &&
    (testDirectories.length > 0 || tsConfigs.length > 0)
  ) {
    detected.push({
      kind: "typescript",
      config_files: ["package.json", ...tsConfigs],
      test_directories: testDirectories,
      suggested_commands: ["npm test"],
    });
  }
  const pythonConfigs = [
    "pyproject.toml",
    "pytest.ini",
    "setup.cfg",
    "tox.ini",
  ].filter((candidate) => paths.has(candidate));
  if (pythonConfigs.length > 0 && testDirectories.length > 0) {
    detected.push({
      kind: "python",
      config_files: pythonConfigs,
      test_directories: testDirectories,
      suggested_commands: ["python -m pytest"],
    });
  }
  return detected;
}
