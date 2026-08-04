import assert from "node:assert/strict";
import test from "node:test";

import { distillContext } from "../src/features/code-graph/index.js";

void test("distillContext strips block comments and line comments in TypeScript", () => {
  const code = `
    /**
     * This is a block comment explaining calculation.
     */
    export function calculate(a: number, b: number): number {
      // Line comment explaining addition
      return a + b;
    }
  `;

  const result = distillContext(code, { language: "typescript" });

  assert.ok(!result.distilledContent.includes("block comment"));
  assert.ok(!result.distilledContent.includes("Line comment"));
  assert.ok(result.distilledContent.includes("export function calculate"));
  assert.ok(result.compressionRatio < 1.0);
});

void test("distillContext strips docstrings and # comments in Python", () => {
  const pythonCode = `
"""
Module level docstring
"""

def add(a, b):
    # Add two numbers
    return a + b
  `;

  const result = distillContext(pythonCode, { language: "python" });

  assert.ok(!result.distilledContent.includes("Module level docstring"));
  assert.ok(!result.distilledContent.includes("# Add two numbers"));
  assert.ok(result.distilledContent.includes("def add(a, b):"));
});

void test("distillContext collapses excessive empty lines", () => {
  const code = `
    function first() {}




    function second() {}
  `;

  const result = distillContext(code, { collapseEmptyLines: true });

  assert.ok(!result.distilledContent.includes("\n\n\n"));
  assert.ok(result.distilledContent.includes("function first"));
  assert.ok(result.distilledContent.includes("function second"));
});

void test("distillContext handles empty source code", () => {
  const result = distillContext("   ");
  assert.equal(result.compressionRatio, 1.0);
});
