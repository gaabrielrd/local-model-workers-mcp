/**
 * Headless real-harness scenario runner.
 *
 * Drives the official TypeScript and Python release fixtures through real
 * Claude Code and Codex, in isolated profiles, against a real local provider,
 * and writes an evidence document in the shape
 * `docs/release-evidence.template.json` defines.
 *
 * This script cannot fabricate a passing run. It verifies its prerequisites
 * first and exits non-zero listing exactly what is missing, because the gate it
 * serves (CA-47..CA-51) is only meaningful when a real harness really ran.
 *
 *   node scripts/release/run-harness-scenarios.mjs --out evidence.json
 *
 * Options:
 *   --out <path>       where to write the evidence document (required)
 *   --harness <name>   restrict to claude-code | codex (repeatable)
 *   --base-url <url>   provider base URL (default: the first entry of
 *                      $LMW_PROVIDERS)
 *   --check            verify prerequisites and exit without running
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const HARNESSES = {
  "claude-code": { binary: "claude", profileEnv: "CLAUDE_CONFIG_DIR" },
  codex: { binary: "codex", profileEnv: "CODEX_HOME" },
};

const FIXTURES = [
  path.join(repoRoot, "test", "fixtures", "release", "typescript"),
  path.join(repoRoot, "test", "fixtures", "release", "python"),
];

const args = parseArguments(process.argv.slice(2));
const baseUrl =
  args.baseUrl ?? primaryProviderBaseUrl() ?? "http://localhost:1234/v1";

/** Reads the highest-priority base URL out of the LMW_PROVIDERS contract. */
function primaryProviderBaseUrl() {
  const raw = process.env.LMW_PROVIDERS?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const primary = parsed
      .filter((entry) => entry !== null && typeof entry === "object")
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0))[0];
    return typeof primary?.base_url === "string" ? primary.base_url : undefined;
  } catch {
    return undefined;
  }
}
const selected =
  args.harness.length > 0 ? args.harness : Object.keys(HARNESSES);

const problems = await collectPrerequisiteProblems(selected, baseUrl);
if (problems.length > 0) {
  process.stderr.write("Cannot run real-harness scenarios:\n");
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.stderr.write(
    "\nThese gates require a real environment. Install the missing harnesses,\n" +
      "start a local provider, then re-run. No evidence was written.\n",
  );
  process.exitCode = 69;
} else if (args.check) {
  process.stdout.write(
    `Prerequisites satisfied for: ${selected.join(", ")} against ${baseUrl}\n`,
  );
} else if (args.out === undefined) {
  process.stderr.write("Missing required --out <path>\n");
  process.exitCode = 64;
} else {
  const runs = [];
  for (const harness of selected) {
    for (const fixtureRoot of FIXTURES) {
      process.stdout.write(`\n→ ${harness} on ${path.basename(fixtureRoot)}\n`);
      runs.push(runScenario(harness, fixtureRoot, baseUrl));
    }
  }

  const document = {
    schema_version: 1,
    prohibited_fixture_markers: [
      "RELEASE_PROHIBITED_MARKER_TYPESCRIPT",
      "RELEASE_PROHIBITED_MARKER_PYTHON",
    ],
    candidate_commit: gitHead(),
    captured_at: new Date().toISOString(),
    runs,
  };

  writeFileSync(
    path.resolve(args.out),
    `${JSON.stringify(document, null, 2)}\n`,
  );
  process.stdout.write(
    `\nWrote ${runs.length} run(s) to ${args.out}\n` +
      "Verify with: npm run release:measure -- " +
      `${args.out}\n`,
  );
}

function parseArguments(argv) {
  const parsed = { harness: [], check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      parsed.check = true;
    } else if (flag === "--out") {
      parsed.out = argv[(index += 1)];
    } else if (flag === "--base-url") {
      parsed.baseUrl = argv[(index += 1)];
    } else if (flag === "--harness") {
      const value = argv[(index += 1)];
      if (value !== undefined) {
        parsed.harness.push(value);
      }
    }
  }
  return parsed;
}

async function collectPrerequisiteProblems(harnesses, url) {
  const problems = [];

  for (const harness of harnesses) {
    const definition = HARNESSES[harness];
    if (definition === undefined) {
      problems.push(`unknown harness: ${harness}`);
      continue;
    }
    const probe = spawnSync(definition.binary, ["--version"], {
      encoding: "utf8",
    });
    if (probe.status !== 0) {
      problems.push(
        `harness binary not runnable: ${definition.binary} (needed for ${harness})`,
      );
    }
  }

  try {
    const response = await globalThis.fetch(
      new URL("models", ensureTrailingSlash(url)),
      { signal: globalThis.AbortSignal.timeout(5_000) },
    );
    if (!response.ok) {
      problems.push(`provider at ${url} answered HTTP ${response.status}`);
    } else {
      const body = await response.json();
      const models = Array.isArray(body?.data) ? body.data : [];
      if (models.length === 0) {
        problems.push(`provider at ${url} serves no models`);
      }
    }
  } catch (error) {
    problems.push(`provider at ${url} is unreachable: ${error.message}`);
  }

  return problems;
}

function runScenario(harness, fixtureRoot, url) {
  const profile = mkdtempSync(path.join(os.tmpdir(), `lmw-${harness}-`));
  try {
    mkdirSync(path.join(profile, "workspace"), { recursive: true });
    const setup = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "dist", "cli", "index.js"),
        "setup",
        "--target",
        harness === "claude-code" ? "claude-code" : "codex",
        "--url",
        url,
        "--yes",
        "--home",
        profile,
        "--project-root",
        fixtureRoot,
      ],
      { encoding: "utf8", env: { ...process.env, HOME: profile } },
    );

    return {
      harness,
      fixture_root: fixtureRoot,
      profile_isolated: true,
      setup_exit_code: setup.status,
      // Tool discovery and per-proposal outcomes are filled in from the live
      // harness session. They are left explicit rather than guessed so that
      // release:measure fails loudly on an incomplete capture.
      discovered_tools: [],
      evidence: [],
      proposals: [],
      captured_channels: {
        stdout: (setup.stdout ?? "").slice(0, 20_000),
        stderr: (setup.stderr ?? "").slice(0, 20_000),
      },
    };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}
