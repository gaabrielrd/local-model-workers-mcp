import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createConfigurationReloader,
  type ConfigReloadWatchPort,
} from "../src/features/mcp-server/index.js";
import {
  getEffectiveConfiguration,
  resolveGlobalPreferencesPath,
} from "../src/features/configuration/index.js";

const environment = {
  LMW_LM_STUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
  LMW_ALLOWED_MODELS: '["qwen/test-model"]',
};

function fakeWatch(): ConfigReloadWatchPort & {
  fire(): void;
  watched(): string | undefined;
} {
  let listener: (() => void) | undefined;
  let watched: string | undefined;
  return {
    watchFile: (filename, _options, next) => {
      watched = filename;
      listener = next;
    },
    unwatchFile: () => {
      listener = undefined;
    },
    fire: () => listener?.(),
    watched: () => watched,
  };
}

async function until(
  condition: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("condition was not met in time");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

void test("start watches the global preferences file and stop unwatches it", async (t) => {
  const fixture = await createFixture(t);
  const watch = fakeWatch();
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    watch,
    writeDiagnostic: () => {},
  });

  assert.equal(reloader.status().watching, false);
  reloader.start();
  assert.equal(reloader.status().watching, true);
  assert.equal(watch.watched(), fixture.globalPath);

  reloader.start();
  assert.equal(watch.watched(), fixture.globalPath);

  reloader.stop();
  assert.equal(reloader.status().watching, false);
});

void test("applies a valid configuration and notifies onApplied", async (t) => {
  const fixture = await createFixture(t);
  const diagnostics: string[] = [];
  const applied: string[] = [];
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    writeDiagnostic: (message) => diagnostics.push(message),
    onApplied: (configuration) => applied.push(configuration.revision),
  });

  const outcome = await reloader.reload();

  assert.equal(outcome.applied, true);
  assert.match(outcome.revision, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(outcome.error, undefined);
  assert.deepEqual(applied, [outcome.revision]);
  assert.deepEqual(diagnostics, [
    `[config] Configuration reloaded (${outcome.revision}).\n`,
  ]);
  assert.equal(reloader.status().last_outcome?.applied, true);
});

void test("rejects an invalid change and keeps the previous configuration", async (t) => {
  const fixture = await createFixture(t);
  const diagnostics: string[] = [];
  const applied: string[] = [];
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    writeDiagnostic: (message) => diagnostics.push(message),
    onApplied: (configuration) => applied.push(configuration.revision),
  });

  const first = await reloader.reload();
  assert.equal(first.applied, true);

  await fixture.writeRawGlobal("{ this is not valid json");

  const second = await reloader.reload();

  assert.equal(second.applied, false);
  assert.match(second.error ?? "", /malformed|JSON|Unexpected/u);
  assert.equal(second.revision, first.revision);
  assert.deepEqual(applied, [first.revision]);
  assert.equal(diagnostics.length, 2);
  assert.equal(
    diagnostics[1],
    "[config] Configuration reload rejected; keeping previous configuration.\n",
  );
});

void test("rejects a valid file that violates configuration policy", async (t) => {
  const fixture = await createFixture(t);
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    writeDiagnostic: () => {},
  });

  await reloader.reload();
  await fixture.writeGlobal({ schema_version: 1 });

  const outcome = await reloader.reload();

  assert.equal(outcome.applied, false);
  assert.match(outcome.error ?? "", /default model is required/u);
});

void test("a watched file change triggers a live reload", async (t) => {
  const fixture = await createFixture(t);
  const diagnostics: string[] = [];
  const watch = fakeWatch();
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    watch,
    writeDiagnostic: (message) => diagnostics.push(message),
  });
  reloader.start();

  watch.fire();
  await until(() => diagnostics.length === 1);

  assert.match(diagnostics[0] ?? "", /Configuration reloaded/u);
  assert.equal(reloader.status().last_outcome?.applied, true);
});

void test("coalesces overlapping reloads into one resolution", async (t) => {
  const fixture = await createFixture(t);
  let resolutions = 0;
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: async () => {
      resolutions += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return fixture.resolve();
    },
    writeDiagnostic: () => {},
  });

  const [first, second] = await Promise.all([
    reloader.reload(),
    reloader.reload(),
  ]);

  assert.equal(resolutions, 1);
  assert.equal(first.applied, true);
  assert.equal(second.applied, true);
  assert.equal(first.revision, second.revision);
});

void test("stop clears the watch so later file changes are ignored", async (t) => {
  const fixture = await createFixture(t);
  const watch = fakeWatch();
  const reloader = createConfigurationReloader({
    watchPath: fixture.globalPath,
    resolveConfiguration: () => fixture.resolve(),
    watch,
    writeDiagnostic: () => {},
  });
  reloader.start();
  reloader.stop();

  watch.fire();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reloader.status().last_outcome, undefined);
});

interface Fixture {
  readonly globalPath: string;
  resolve(): ReturnType<typeof getEffectiveConfiguration>;
  writeGlobal(value: unknown): Promise<void>;
  writeRawGlobal(value: string): Promise<void>;
}

async function createFixture(t: test.TestContext): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lmw-reload-"));
  const homeDirectory = path.join(root, "home");
  const globalPath = resolveGlobalPreferencesPath({
    platform: "darwin",
    homeDirectory,
    environment,
  });
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(path.dirname(globalPath), { recursive: true });
  await writeFile(
    globalPath,
    `${JSON.stringify({ schema_version: 1, default_model: "qwen/test-model" })}\n`,
    "utf8",
  );
  t.after(async () => rm(root, { recursive: true, force: true }));

  return {
    globalPath,
    resolve: () =>
      getEffectiveConfiguration({
        platform: "darwin",
        homeDirectory,
        environment,
      }),
    async writeGlobal(value: unknown) {
      await writeFile(globalPath, JSON.stringify(value), "utf8");
    },
    async writeRawGlobal(value: string) {
      await writeFile(globalPath, value, "utf8");
    },
  };
}
