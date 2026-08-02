import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REPOSITORY_OPERATION_LIMITS,
  RepositoryAccessError,
  createRepositoryReadCapability,
  isPathContained,
  validateExplorationRequest,
  type RepositoryFileSystem,
} from "../src/features/repository-exploration/index.js";

void test("validates exploration input before repository or network work", () => {
  assert.throws(
    () =>
      validateExplorationRequest({
        goal: "   ",
        repository_root: "/not-consulted",
      }),
    isRepositoryError("invalid_request", "open_repository"),
  );
  const request = validateExplorationRequest({
    goal: "Find the authorization flow",
    repository_root: "/repository",
    priority_paths: ["src"],
  });
  assert.equal(request.goal, "Find the authorization flow");
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.priority_paths), true);
});

void test("opens only valid directory roots and exposes three read operations", async (t) => {
  const fixture = await createFixture(t);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
  });

  assert.deepEqual(Object.keys(capability).sort(), [
    "listDirectory",
    "readSnippet",
    "searchText",
  ]);
  assert.equal(Object.isFrozen(capability), true);

  await assert.rejects(
    createRepositoryReadCapability({
      repositoryRoot: path.join(fixture.root, "missing"),
    }),
    isRepositoryError("repository_not_found", "open_repository"),
  );
  await assert.rejects(
    createRepositoryReadCapability({
      repositoryRoot: path.join(fixture.root, "alpha.txt"),
    }),
    isRepositoryError("repository_not_found", "open_repository"),
  );
});

void test("maps inaccessible roots to a fixed redaction-safe error", async () => {
  const denied = Object.assign(new Error("secret raw filesystem detail"), {
    code: "EACCES",
  });
  const fileSystem: RepositoryFileSystem = {
    realpath: () => Promise.resolve("/canonical/repository"),
    stat: () => Promise.reject(denied),
    readdir: () => Promise.resolve([]),
    readFile: () => Promise.resolve(Buffer.alloc(0)),
  };

  let caught: unknown;
  try {
    await createRepositoryReadCapability({
      repositoryRoot: "/private/repository",
      fileSystem,
    });
  } catch (error: unknown) {
    caught = error;
  }
  assert.ok(caught instanceof RepositoryAccessError);
  assert.equal(caught.code, "repository_access_denied");
  assert.equal(caught.message.includes("secret raw filesystem detail"), false);
  assert.equal(caught.message.includes("/private/repository"), false);
});

void test("rejects traversal, sibling prefixes, and escaping symlinks", async (t) => {
  const fixture = await createFixture(t);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
  });

  await assert.rejects(
    capability.readSnippet({ path: "../outside.txt" }),
    isRepositoryError("repository_access_denied", "read_snippet"),
  );
  await assert.rejects(
    capability.readSnippet({ path: fixture.siblingFile }),
    isRepositoryError("repository_access_denied", "read_snippet"),
  );
  await assert.rejects(
    capability.readSnippet({ path: "outside-link.txt" }),
    isRepositoryError("repository_access_denied", "read_snippet"),
  );

  const inside = await capability.readSnippet({
    path: path.join(fixture.root, "nested", "inside-link.txt"),
    line_count: 1,
  });
  assert.equal(inside.path, "alpha.txt");
  assert.equal(inside.content, "first line");
});

void test("validates every priority path before returning a capability", async (t) => {
  const fixture = await createFixture(t);

  await assert.rejects(
    createRepositoryReadCapability({
      repositoryRoot: fixture.root,
      priorityPaths: ["nested", "../outside.txt"],
    }),
    isRepositoryError("repository_access_denied", "open_repository"),
  );
});

void test("reads the authorized canonical target if a symlink changes afterward", async (t) => {
  const fixture = await createFixture(t);
  let swapped = false;
  const fileSystem: RepositoryFileSystem = {
    async realpath(targetPath) {
      const canonical = await realpath(targetPath);
      if (
        targetPath.endsWith(path.join("nested", "inside-link.txt")) &&
        !swapped
      ) {
        await rm(targetPath);
        await symlink(fixture.siblingFile, targetPath);
        swapped = true;
      }
      return canonical;
    },
    stat,
    readdir: async (targetPath, options) => readdir(targetPath, options),
    readFile: async (targetPath) => readFile(targetPath),
  };
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
    fileSystem,
  });

  const snippet = await capability.readSnippet({
    path: "nested/inside-link.txt",
    line_count: 1,
  });

  assert.equal(swapped, true);
  assert.equal(snippet.path, "alpha.txt");
  assert.equal(snippet.content, "first line");
  assert.equal(snippet.content.includes("outside secret"), false);
});

void test("lists directories deterministically with kinds and bounds", async (t) => {
  const fixture = await createFixture(t);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
  });

  const listing = await capability.listDirectory({ max_entries: 3 });

  assert.deepEqual(
    listing.entries.map((entry) => [entry.name, entry.kind]),
    [
      ["alpha.txt", "file"],
      ["binary.bin", "file"],
      ["large.txt", "file"],
    ],
  );
  assert.equal(listing.truncated, true);
  assert.equal(Object.isFrozen(listing.entries), true);
  await assert.rejects(
    capability.listDirectory({ path: "alpha.txt" }),
    isRepositoryError("invalid_request", "list_directory"),
  );
  await assert.rejects(
    capability.listDirectory({ max_entries: 501 }),
    isRepositoryError("invalid_request", "list_directory"),
  );
});

void test("searches bounded text literally and with the safe regex subset", async (t) => {
  const fixture = await createFixture(t);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
  });

  const literal = await capability.searchText({
    path: ".",
    query: "todo",
    case_sensitive: false,
    max_results: 2,
  });
  assert.deepEqual(
    literal.matches.map((match) => [match.path, match.line]),
    [
      ["alpha.txt", 2],
      ["nested/beta.txt", 1],
    ],
  );
  assert.equal(literal.truncated, true);

  const regex = await capability.searchText({
    path: "nested",
    query: "TODO|FIXME",
    mode: "regex",
  });
  assert.deepEqual(
    regex.matches.map((match) => match.preview),
    ["TODO nested", "FIXME nested"],
  );
  await assert.rejects(
    capability.searchText({ query: "(a+)+$", mode: "regex" }),
    isRepositoryError("invalid_request", "search_text"),
  );
  await assert.rejects(
    capability.searchText({ query: "x", mode: "unsupported" } as never),
    isRepositoryError("invalid_request", "search_text"),
  );
});

void test("reads line-addressed snippets within line, byte, and file bounds", async (t) => {
  const fixture = await createFixture(t);
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
  });

  const snippet = await capability.readSnippet({
    path: "alpha.txt",
    start_line: 2,
    line_count: 2,
  });
  assert.deepEqual(snippet, {
    path: "alpha.txt",
    start_line: 2,
    end_line: 3,
    content: "TODO root\nlast line",
    truncated: false,
  });
  await assert.rejects(
    capability.readSnippet({ path: "alpha.txt", start_line: 99 }),
    isRepositoryError("invalid_request", "read_snippet"),
  );
  await assert.rejects(
    capability.readSnippet({ path: "large.txt" }),
    isRepositoryError("context_limit_exceeded", "read_snippet"),
  );
  await assert.rejects(
    capability.readSnippet({ path: "binary.bin" }),
    isRepositoryError("invalid_request", "read_snippet"),
  );
});

void test("fails closed when the canonical root identity changes", async (t) => {
  const fixture = await createFixture(t);
  const canonicalRoot = await realpath(fixture.root);
  let rootStatsCalls = 0;
  const fileSystem: RepositoryFileSystem = {
    realpath,
    async stat(targetPath) {
      const current = await stat(targetPath);
      if (targetPath === canonicalRoot) {
        rootStatsCalls += 1;
        if (rootStatsCalls >= 2) {
          return {
            dev: current.dev,
            ino: current.ino + 1,
            size: current.size,
            isDirectory: () => current.isDirectory(),
            isFile: () => current.isFile(),
          };
        }
      }
      return current;
    },
    readdir: async (targetPath, options) => readdir(targetPath, options),
    readFile: async (targetPath) => readFile(targetPath),
  };
  const capability = await createRepositoryReadCapability({
    repositoryRoot: fixture.root,
    fileSystem,
  });

  await assert.rejects(
    capability.listDirectory(),
    isRepositoryError("repository_access_denied", "list_directory"),
  );
});

void test("uses component-aware containment on POSIX and case-insensitive Windows paths", () => {
  assert.equal(
    isPathContained("/repo/app", "/repo/app/src/a.ts", "linux"),
    true,
  );
  assert.equal(
    isPathContained("/repo/app", "/repo/application/a.ts", "linux"),
    false,
  );
  assert.equal(
    isPathContained(
      "C:\\Users\\Dev\\Repo",
      "c:\\users\\dev\\repo\\src\\a.ts",
      "win32",
    ),
    true,
  );
  assert.equal(
    isPathContained(
      "C:\\Users\\Dev\\Repo",
      "C:\\Users\\Dev\\Repo-Other\\a.ts",
      "win32",
    ),
    false,
  );
});

interface Fixture {
  readonly root: string;
  readonly siblingFile: string;
}

async function createFixture(t: test.TestContext): Promise<Fixture> {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "lmw-repository-access-"),
  );
  const root = path.join(parent, "repo");
  const nested = path.join(root, "nested");
  const siblingFile = path.join(parent, "outside.txt");
  const insideLink = path.join(nested, "inside-link.txt");
  await mkdir(nested, { recursive: true });
  await writeFile(
    path.join(root, "alpha.txt"),
    "first line\nTODO root\nlast line",
    "utf8",
  );
  await writeFile(
    path.join(nested, "beta.txt"),
    "TODO nested\nFIXME nested",
    "utf8",
  );
  await writeFile(siblingFile, "outside secret", "utf8");
  await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(
    path.join(root, "large.txt"),
    Buffer.alloc(REPOSITORY_OPERATION_LIMITS.max_read_file_bytes + 1, 97),
  );
  await symlink(path.join(root, "alpha.txt"), insideLink);
  await symlink(siblingFile, path.join(root, "outside-link.txt"));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  return { root, siblingFile };
}

function isRepositoryError(
  code: string,
  operation: string,
): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof RepositoryAccessError &&
    error.code === code &&
    error.operation === operation;
}
