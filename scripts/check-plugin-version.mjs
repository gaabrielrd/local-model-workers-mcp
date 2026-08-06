/**
 * Keeps the Claude Code plugin pinned to the version of this package.
 *
 * The plugin ships a manifest version and an `npx` argument that pins the
 * published server. A release that bumps only package.json would leave users
 * installing the previous server, so this check runs in CI.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const read = async (relativePath) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));

const packageJson = await read("../package.json");
const pluginManifest = await read("../plugin/.claude-plugin/plugin.json");
const pluginMcp = await read("../plugin/.mcp.json");
const marketplace = await read("../.claude-plugin/marketplace.json");

const { name, version } = packageJson;
const expectedSpecifier = `${name}@${version}`;
const server = pluginMcp.mcpServers?.[name.replace(/-mcp$/u, "")];
const marketplaceEntry = marketplace.plugins?.find(
  (plugin) => plugin.name === pluginManifest.name,
);

const problems = [];

if (pluginManifest.version !== version) {
  problems.push(
    `plugin/.claude-plugin/plugin.json version is ${pluginManifest.version}, expected ${version}`,
  );
}

if (server === undefined) {
  problems.push(
    `plugin/.mcp.json does not define the ${name.replace(/-mcp$/u, "")} server`,
  );
} else if (!server.args?.includes(expectedSpecifier)) {
  problems.push(
    `plugin/.mcp.json pins ${JSON.stringify(server.args)}, expected an argument ${expectedSpecifier}`,
  );
}

if (marketplaceEntry === undefined) {
  problems.push(
    `.claude-plugin/marketplace.json has no entry named ${pluginManifest.name}`,
  );
} else if (marketplaceEntry.version !== version) {
  problems.push(
    `.claude-plugin/marketplace.json version is ${marketplaceEntry.version}, expected ${version}`,
  );
}

if (problems.length > 0) {
  process.stderr.write(
    `Plugin version is out of sync with package.json (${version}):\n${problems
      .map((problem) => `  - ${problem}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Plugin is in sync at ${expectedSpecifier}.\n`);
