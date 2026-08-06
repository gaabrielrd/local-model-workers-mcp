import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCallEdges,
  parseSourceSymbols,
  supportsCallExtraction,
} from "../src/features/code-graph/index.js";

function edgesFor(filePath: string, content: string) {
  return extractCallEdges({
    filePath,
    content,
    symbols: parseSourceSymbols(filePath, content),
  });
}

void test("supported languages are declared, so callers can tell 'none' from 'not analyzed'", () => {
  for (const file of ["a.ts", "a.tsx", "a.js", "a.mjs", "a.py", "a.go"]) {
    assert.equal(supportsCallExtraction(file), true, file);
  }
  for (const file of ["a.rs", "a.java", "a.rb", "a.md", "noext"]) {
    assert.equal(supportsCallExtraction(file), false, file);
  }
});

void test("TypeScript calls inside a function body become edges", () => {
  const source = [
    "export function helper(x) {",
    "  return x + 1;",
    "}",
    "export function main() {",
    "  const a = helper(1);",
    "  return a;",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  const call = edges.find((edge) => edge.to === "helper");

  assert.notEqual(call, undefined, "main -> helper must be found");
  assert.equal(call?.from, "src/app.ts:main");
  assert.equal(call?.filePath, "src/app.ts");
  // Declared in this file, so the textual match is corroborated.
  assert.equal(call?.confidence, "high");
  assert.equal(call?.line, 5);
});

void test("a callee not declared in the file is reported at lower confidence", () => {
  const source = [
    "export function main() {",
    "  return somethingImported(1);",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  const call = edges.find((edge) => edge.to === "somethingImported");
  assert.equal(call?.confidence, "medium");
});

void test("method calls are captured by their method name", () => {
  const source = [
    "export function run() {",
    "  service.process(payload);",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  assert.equal(
    edges.some((edge) => edge.to === "process"),
    true,
  );
  // The receiver is not itself a call.
  assert.equal(
    edges.some((edge) => edge.to === "service"),
    false,
  );
});

void test("Python and Go bodies are analyzed too", () => {
  const python = [
    "def helper(x):",
    "    return x",
    "",
    "def main():",
    "    return helper(1)",
    "",
  ].join("\n");
  const pythonEdges = edgesFor("app.py", python);
  assert.equal(
    pythonEdges.some(
      (edge) => edge.from === "app.py:main" && edge.to === "helper",
    ),
    true,
  );

  const go = [
    "func helper(x int) int {",
    "\treturn x",
    "}",
    "",
    "func main() {",
    "\thelper(1)",
    "}",
  ].join("\n");
  const goEdges = edgesFor("main.go", go);
  assert.equal(
    goEdges.some(
      (edge) => edge.from === "main.go:main" && edge.to === "helper",
    ),
    true,
  );
});

void test("an unsupported language yields no edges rather than guesses", () => {
  const rust = [
    "pub fn helper(x: i32) -> i32 {",
    "    x",
    "}",
    "pub fn main() {",
    "    helper(1);",
    "}",
  ].join("\n");
  assert.deepEqual(edgesFor("lib.rs", rust), []);
});

void test("language keywords and builtins are not reported as project calls", () => {
  const source = [
    "export function main(items) {",
    "  if (items.length > 0) {",
    "    for (const item of items) {",
    "      console.log(item);",
    "    }",
    "  }",
    "  return JSON.stringify(items);",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  const names = new Set(edges.map((edge) => edge.to));
  for (const noise of ["if", "for", "console", "JSON"]) {
    assert.equal(names.has(noise), false, `${noise} must not be an edge`);
  }
});

void test("calls inside strings and comments are ignored", () => {
  const source = [
    "export function main() {",
    '  const message = "call notReal(1) here";',
    "  // alsoNotReal(2)",
    "  return realCall(3);",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  const names = new Set(edges.map((edge) => edge.to));
  assert.equal(names.has("notReal"), false, "string contents are not code");
  assert.equal(names.has("alsoNotReal"), false, "comments are not code");
  assert.equal(names.has("realCall"), true);
});

void test("direct recursion is not reported as a dependency", () => {
  const source = [
    "export function walk(node) {",
    "  if (node.child) {",
    "    walk(node.child);",
    "  }",
    "}",
  ].join("\n");

  const edges = edgesFor("src/app.ts", source);
  assert.equal(
    edges.some((edge) => edge.to === "walk"),
    false,
    "a function calling itself adds no dependency information",
  );
});

void test("the signature line is not treated as a call site", () => {
  const source = ["export function main(a, b) {", "  return a + b;", "}"].join(
    "\n",
  );
  const edges = edgesFor("src/app.ts", source);
  assert.equal(
    edges.some((edge) => edge.to === "main"),
    false,
  );
});

void test("a file with no callable symbols yields no edges", () => {
  assert.deepEqual(
    edgesFor("src/types.ts", "export interface A { x: number }"),
    [],
  );
});
