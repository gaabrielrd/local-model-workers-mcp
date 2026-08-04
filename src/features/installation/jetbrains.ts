import path from "node:path";

const JETBRAINS_CONFIG_DIRECTORY_NAME = "JetBrains";
const AI_ASSISTANT_DIRECTORY_NAME = "AIAssistant";
const MCP_CONFIG_FILENAME = "mcp.json";
const RULES_DIRECTORY_NAME = ".aiassistant";
const STEERING_RULES_FILENAME = "local-model-workers.md";

const JETBRAINS_PRODUCTS = [
  "IntelliJIdea",
  "IdeaIC",
  "PyCharm",
  "WebStorm",
  "GoLand",
  "CLion",
] as const;

export interface JetBrainsVersion {
  readonly year: number;
  readonly major: number;
}

export const JETBRAINS_MIN_MCP_VERSION: JetBrainsVersion = Object.freeze({
  year: 2025,
  major: 1,
});

export interface JetBrainsIdeInstallation {
  readonly product: string;
  readonly version: JetBrainsVersion;
  readonly supported: boolean;
}

export function resolveJetBrainsMcpConfigPath(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): string {
  return joinPlatform(input.platform)(
    resolveJetBrainsConfigRoot(input),
    AI_ASSISTANT_DIRECTORY_NAME,
    MCP_CONFIG_FILENAME,
  );
}

export function resolveJetBrainsRulesPath(projectRoot: string): string {
  return path.resolve(
    projectRoot,
    RULES_DIRECTORY_NAME,
    "rules",
    STEERING_RULES_FILENAME,
  );
}

export function resolveJetBrainsConfigRoot(input: {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): string {
  if (input.platform === "win32") {
    const appData = nonEmpty(input.environment.APPDATA);
    const base =
      appData ?? path.win32.join(input.homeDirectory, "AppData", "Roaming");
    return path.win32.join(base, JETBRAINS_CONFIG_DIRECTORY_NAME);
  }
  if (input.platform === "darwin") {
    return path.posix.join(
      input.homeDirectory,
      "Library",
      "Application Support",
      JETBRAINS_CONFIG_DIRECTORY_NAME,
    );
  }
  const xdgConfigHome = nonEmpty(input.environment.XDG_CONFIG_HOME);
  const base = xdgConfigHome ?? path.posix.join(input.homeDirectory, ".config");
  return path.posix.join(base, JETBRAINS_CONFIG_DIRECTORY_NAME);
}

export interface JetBrainsDirectoryReader {
  readDirectory(directory: string): Promise<readonly string[]>;
}

export interface DetectJetBrainsIdeVersionsInput {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly reader?: JetBrainsDirectoryReader;
}

export async function detectJetBrainsIdeVersions(
  input: DetectJetBrainsIdeVersionsInput,
): Promise<readonly JetBrainsIdeInstallation[]> {
  const root = resolveJetBrainsConfigRoot(input);
  let entries: readonly string[];
  try {
    entries = await (input.reader ?? nodeReader).readDirectory(root);
  } catch {
    return [];
  }
  const installations: JetBrainsIdeInstallation[] = [];
  for (const entry of entries) {
    const parsed = parseInstallation(entry);
    if (parsed === undefined) continue;
    installations.push(parsed);
  }
  installations.sort(
    (left, right) =>
      left.product.localeCompare(right.product) ||
      left.version.year - right.version.year ||
      left.version.major - right.version.major,
  );
  return Object.freeze(
    installations.map((installation) => Object.freeze(installation)),
  );
}

export function describeJetBrainsVersionWarnings(
  installations: readonly JetBrainsIdeInstallation[],
): readonly string[] {
  const warnings: string[] = [];
  for (const installation of installations) {
    if (installation.supported) continue;
    const product = describeJetBrainsProduct(installation.product);
    warnings.push(
      `${product} ${formatVersion(installation.version)} does not support MCP (requires ${formatVersion(JETBRAINS_MIN_MCP_VERSION)} or later); the shared configuration still applies to newer versions.`,
    );
  }
  return Object.freeze(warnings);
}

function parseInstallation(
  entry: string,
): JetBrainsIdeInstallation | undefined {
  const product = JETBRAINS_PRODUCTS.find((candidate) =>
    entry.startsWith(candidate),
  );
  if (product === undefined) return undefined;
  const suffix = entry.slice(product.length);
  const version = parseVersion(suffix);
  if (version === undefined) return undefined;
  return {
    product,
    version,
    supported: isSupported(version),
  };
}

function parseVersion(suffix: string): JetBrainsVersion | undefined {
  const match = /^(\d{4})\.(\d+)$/u.exec(suffix);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const major = Number(match[2]);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(major)) {
    return undefined;
  }
  return { year, major };
}

function isSupported(version: JetBrainsVersion): boolean {
  return (
    version.year > JETBRAINS_MIN_MCP_VERSION.year ||
    (version.year === JETBRAINS_MIN_MCP_VERSION.year &&
      version.major >= JETBRAINS_MIN_MCP_VERSION.major)
  );
}

function describeJetBrainsProduct(product: string): string {
  if (product === "IntelliJIdea") return "IntelliJ IDEA";
  if (product === "IdeaIC") return "IntelliJ IDEA Community";
  return product;
}

function formatVersion(version: JetBrainsVersion): string {
  return `${version.year}.${version.major}`;
}

const nodeReader: JetBrainsDirectoryReader = {
  readDirectory: async (directory) => {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  },
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function joinPlatform(
  platform: NodeJS.Platform,
): (...parts: readonly string[]) => string {
  return platform === "win32"
    ? (...parts: readonly string[]) => path.win32.join(...parts)
    : (...parts: readonly string[]) => path.posix.join(...parts);
}
