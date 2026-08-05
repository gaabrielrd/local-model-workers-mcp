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

void test("distillContext strips hash comments in Ruby and Elixir", () => {
  const ruby = `
class Report
  # Builds the report body
  def build(data)
    data # inline note
  end
end
`;
  const rubyResult = distillContext(ruby, { language: "ruby" });
  assert.ok(!rubyResult.distilledContent.includes("# Builds"));
  assert.ok(!rubyResult.distilledContent.includes("inline note"));
  assert.ok(rubyResult.distilledContent.includes("def build(data)"));

  const elixir = `
# Payment module
defmodule Payment do
  # Charges the amount
  def charge(amount) do
    amount
  end
end
`;
  const elixirResult = distillContext(elixir, { language: "elixir" });
  assert.ok(!elixirResult.distilledContent.includes("# Payment module"));
  assert.ok(!elixirResult.distilledContent.includes("# Charges"));
  assert.ok(elixirResult.distilledContent.includes("defmodule Payment do"));
});

void test("distillContext strips hash, slash, and block comments in PHP", () => {
  const php = `
<?php
# Config bootstrap
/* Block comment */
class Service {
  // Line comment
  public function run() { return 1; } # trailing
}
`;
  const result = distillContext(php, { language: "php" });

  assert.ok(!result.distilledContent.includes("# Config bootstrap"));
  assert.ok(!result.distilledContent.includes("Block comment"));
  assert.ok(!result.distilledContent.includes("Line comment"));
  assert.ok(!result.distilledContent.includes("trailing"));
  assert.ok(result.distilledContent.includes("public function run"));
});

void test("distillContext keeps C-style stripping for Kotlin, Swift, and Scala", () => {
  const kotlin = `
// Kotlin comment
fun process() {
  /* block */ return 1
}
`;
  const kotlinResult = distillContext(kotlin, { language: "kotlin" });
  assert.ok(!kotlinResult.distilledContent.includes("Kotlin comment"));
  assert.ok(!kotlinResult.distilledContent.includes("block"));
  assert.ok(kotlinResult.distilledContent.includes("fun process()"));

  const swift = `
// Swift comment
func load() { return 1 }
`;
  const swiftResult = distillContext(swift, { language: "swift" });
  assert.ok(!swiftResult.distilledContent.includes("Swift comment"));
  assert.ok(swiftResult.distilledContent.includes("func load()"));

  const scala = `
// Scala comment
def run(): Int = 1
`;
  const scalaResult = distillContext(scala, { language: "scala" });
  assert.ok(!scalaResult.distilledContent.includes("Scala comment"));
  assert.ok(scalaResult.distilledContent.includes("def run()"));
});
