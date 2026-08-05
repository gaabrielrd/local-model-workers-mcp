import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryCodeGraph,
  parseSourceSymbols,
} from "../src/features/code-graph/index.js";

const TS_FIXTURE = `
import { createHash } from "node:crypto";

export interface UserProfile {
  id: string;
  name: string;
}

export type UserRole = "admin" | "user";

export class UserService {
  public getUser(): UserProfile {
    return { id: "1", name: "Alice" };
  }
}

export async function fetchUser(id: string): Promise<UserProfile> {
  return { id, name: "Alice" };
}

const formatUser = (user: UserProfile) => user.name;
`;

const PY_FIXTURE = `
import os
from sys import path

class DataProcessor:
    def process(self, data):
        return data

def run_pipeline():
    processor = DataProcessor()
    return processor.process({})
`;

void test("parse a TypeScript file with functions, classes, interfaces, and type aliases", () => {
  const symbols = parseSourceSymbols("src/user.ts", TS_FIXTURE);

  const kinds = symbols.map((s) => s.kind);
  assert.ok(kinds.includes("import"));
  assert.ok(kinds.includes("interface"));
  assert.ok(kinds.includes("type_alias"));
  assert.ok(kinds.includes("class"));
  assert.ok(kinds.includes("function"));

  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("UserProfile"));
  assert.ok(names.includes("UserRole"));
  assert.ok(names.includes("UserService"));
  assert.ok(names.includes("fetchUser"));
  assert.ok(names.includes("formatUser"));
});

void test("parse a Python file with functions, classes, methods, and imports", () => {
  const symbols = parseSourceSymbols("app/pipeline.py", PY_FIXTURE);

  const kinds = symbols.map((s) => s.kind);
  assert.ok(kinds.includes("import"));
  assert.ok(kinds.includes("class"));
  assert.ok(kinds.includes("method"));
  assert.ok(kinds.includes("function"));

  const names = symbols.map((s) => s.name);
  assert.ok(names.includes("os"));
  assert.ok(names.includes("sys"));
  assert.ok(names.includes("DataProcessor"));
  assert.ok(names.includes("process"));
  assert.ok(names.includes("run_pipeline"));
});

void test("code graph queries: symbol, callers, dependencies, exports", () => {
  const graph = new InMemoryCodeGraph();
  const tsSymbols = parseSourceSymbols("src/user.ts", TS_FIXTURE);
  const pySymbols = parseSourceSymbols("app/pipeline.py", PY_FIXTURE);

  graph.updateFile("src/user.ts", "hash1", tsSymbols);
  graph.updateFile("app/pipeline.py", "hash2", pySymbols);

  // Symbol query
  const symbolRes = graph.query({
    repository_root: "/repo",
    query: "User",
    query_type: "symbol",
  });
  assert.ok(symbolRes.symbols.length > 0);
  assert.ok(symbolRes.symbols.some((s) => s.name === "UserService"));

  // Callers query
  const callersRes = graph.query({
    repository_root: "/repo",
    query: "crypto",
    query_type: "callers",
  });
  assert.equal(callersRes.symbols.length, 1);
  assert.equal(callersRes.symbols[0]?.filePath, "src/user.ts");

  // Dependencies query
  const depsRes = graph.query({
    repository_root: "/repo",
    query: "src/user.ts",
    query_type: "dependencies",
  });
  assert.ok(depsRes.symbols.length > 0);

  // Exports query
  const exportsRes = graph.query({
    repository_root: "/repo",
    query: "",
    query_type: "exports",
  });
  assert.ok(exportsRes.symbols.length > 0);
  assert.ok(exportsRes.symbols.every((s) => s.exported));
});

void test("file_filter restricts query results to matching paths", () => {
  const graph = new InMemoryCodeGraph();
  graph.updateFile(
    "src/user.ts",
    "hash1",
    parseSourceSymbols("src/user.ts", TS_FIXTURE),
  );
  graph.updateFile(
    "app/pipeline.py",
    "hash2",
    parseSourceSymbols("app/pipeline.py", PY_FIXTURE),
  );

  const filtered = graph.query({
    repository_root: "/repo",
    query: "",
    query_type: "exports",
    file_filter: "app/",
  });

  assert.ok(filtered.symbols.every((s) => s.filePath.includes("app/")));
});

void test("content hash staleness and removal", () => {
  const graph = new InMemoryCodeGraph();
  graph.updateFile(
    "file.ts",
    "hashOriginal",
    parseSourceSymbols("file.ts", TS_FIXTURE),
  );

  assert.equal(graph.isStale("file.ts", "hashOriginal"), false);
  assert.equal(graph.isStale("file.ts", "hashModified"), true);

  graph.removeFile("file.ts");
  assert.equal(graph.size(), 0);
  assert.equal(graph.isStale("file.ts", "hashOriginal"), true);
});

void test("unsupported file extensions return empty symbols without crashing", () => {
  const symbols = parseSourceSymbols("styles.css", "body { color: red; }");
  assert.equal(symbols.length, 0);
});

void test("parse Go, Rust, Java, and C# files with symbols and export status", () => {
  const goFixture = `
package main
import "fmt"
type User struct {}
func ExportedFunc() {}
func unexportedFunc() {}
`;
  const goSymbols = parseSourceSymbols("main.go", goFixture);
  assert.ok(goSymbols.some((s) => s.name === "User" && s.exported));
  assert.ok(goSymbols.some((s) => s.name === "ExportedFunc" && s.exported));
  assert.ok(goSymbols.some((s) => s.name === "unexportedFunc" && !s.exported));

  const rustFixture = `
use std::collections::HashMap;
pub struct Config {}
pub fn run() {}
fn internal() {}
`;
  const rustSymbols = parseSourceSymbols("lib.rs", rustFixture);
  assert.ok(rustSymbols.some((s) => s.name === "Config" && s.exported));
  assert.ok(rustSymbols.some((s) => s.name === "run" && s.exported));
  assert.ok(rustSymbols.some((s) => s.name === "internal" && !s.exported));

  const javaFixture = `
import java.util.List;
public class AppService {
  public void execute() {}
  private void helper() {}
}
`;
  const javaSymbols = parseSourceSymbols("AppService.java", javaFixture);
  assert.ok(javaSymbols.some((s) => s.name === "AppService" && s.exported));
  assert.ok(javaSymbols.some((s) => s.name === "execute" && s.exported));

  const csFixture = `
using System;
public class OrderProcessor {
  public void ProcessOrder() {}
}
`;
  const csSymbols = parseSourceSymbols("OrderProcessor.cs", csFixture);
  assert.ok(csSymbols.some((s) => s.name === "OrderProcessor" && s.exported));
  assert.ok(csSymbols.some((s) => s.name === "ProcessOrder" && s.exported));
});

void test("parse Kotlin, Swift, and Scala files with symbols and export status", () => {
  const kotlinFixture = `
import kotlinx.coroutines.launch

data class User(val id: String)

interface UserRepository {
    fun findById(id: String): User?
}

class UserService {
    private fun helper() {}
    fun process(): User { return User("1") }
}

fun topLevel() {
    val x = 1
}
`;
  const kotlinSymbols = parseSourceSymbols("UserService.kt", kotlinFixture);
  assert.ok(
    kotlinSymbols.some(
      (s) => s.name === "kotlinx.coroutines.launch" && s.kind === "import",
    ),
  );
  assert.ok(kotlinSymbols.some((s) => s.name === "User" && s.kind === "class"));
  assert.ok(
    kotlinSymbols.some(
      (s) => s.name === "UserRepository" && s.kind === "interface",
    ),
  );
  assert.ok(
    kotlinSymbols.some(
      (s) => s.name === "helper" && s.kind === "method" && !s.exported,
    ),
  );
  assert.ok(
    kotlinSymbols.some(
      (s) => s.name === "process" && s.kind === "method" && s.exported,
    ),
  );
  assert.ok(
    kotlinSymbols.some(
      (s) => s.name === "topLevel" && s.kind === "function" && s.exported,
    ),
  );

  const swiftFixture = `
import Foundation

public protocol CartStore: AnyObject {
    func load() -> [String]
}

public struct CartItem {
    let id: String
}

class CheckoutService {
    private func secret() {}
    func total() -> Double { return 0 }
}
`;
  const swiftSymbols = parseSourceSymbols("CartService.swift", swiftFixture);
  assert.ok(
    swiftSymbols.some((s) => s.name === "Foundation" && s.kind === "import"),
  );
  assert.ok(
    swiftSymbols.some(
      (s) => s.name === "CartStore" && s.kind === "interface" && s.exported,
    ),
  );
  assert.ok(
    swiftSymbols.some(
      (s) => s.name === "CartItem" && s.kind === "class" && s.exported,
    ),
  );
  assert.ok(
    swiftSymbols.some(
      (s) => s.name === "CheckoutService" && s.kind === "class",
    ),
  );
  assert.ok(swiftSymbols.some((s) => s.name === "secret" && !s.exported));
  assert.ok(
    swiftSymbols.some((s) => s.name === "total" && s.kind === "function"),
  );

  const scalaFixture = `
import akka.actor.ActorSystem

trait Repository[T] {
  def find(id: String): Option[T]
}

case class User(id: String)

object Main {
  def run(): Unit = {}
  private def helper(): Unit = {}
}
`;
  const scalaSymbols = parseSourceSymbols("Main.scala", scalaFixture);
  assert.ok(
    scalaSymbols.some(
      (s) => s.name === "akka.actor.ActorSystem" && s.kind === "import",
    ),
  );
  assert.ok(
    scalaSymbols.some(
      (s) => s.name === "Repository" && s.kind === "interface" && s.exported,
    ),
  );
  assert.ok(scalaSymbols.some((s) => s.name === "User" && s.kind === "class"));
  assert.ok(scalaSymbols.some((s) => s.name === "Main" && s.kind === "class"));
  assert.ok(
    scalaSymbols.some(
      (s) => s.name === "run" && s.kind === "method" && s.exported,
    ),
  );
  assert.ok(
    scalaSymbols.some(
      (s) => s.name === "helper" && s.kind === "method" && !s.exported,
    ),
  );
});

void test("parse PHP, Ruby, and Elixir files with symbols and export status", () => {
  const phpFixture = `
<?php
namespace App\\Service;

use App\\Model\\User;

interface UserGateway {
    public function find(int $id): ?User;
}

class UserService {
    private function helper(): void {}
    public function process(User $user): User { return $user; }
}

function top_level(): void {}
`;
  const phpSymbols = parseSourceSymbols("UserService.php", phpFixture);
  assert.ok(
    phpSymbols.some(
      (s) => s.name === "App\\Model\\User" && s.kind === "import",
    ),
  );
  assert.ok(
    phpSymbols.some((s) => s.name === "UserGateway" && s.kind === "interface"),
  );
  assert.ok(
    phpSymbols.some((s) => s.name === "UserService" && s.kind === "class"),
  );
  assert.ok(
    phpSymbols.some(
      (s) => s.name === "helper" && s.kind === "method" && !s.exported,
    ),
  );
  assert.ok(
    phpSymbols.some(
      (s) => s.name === "process" && s.kind === "method" && s.exported,
    ),
  );
  assert.ok(
    phpSymbols.some(
      (s) => s.name === "top_level" && s.kind === "function" && s.exported,
    ),
  );

  const rubyFixture = `
require "json"

class ReportGenerator
  def build(data)
    data
  end

  private

  def _format(row)
    row
  end
end

def standalone
  true
end
`;
  const rubySymbols = parseSourceSymbols("report.rb", rubyFixture);
  assert.ok(rubySymbols.some((s) => s.name === "json" && s.kind === "import"));
  assert.ok(
    rubySymbols.some((s) => s.name === "ReportGenerator" && s.kind === "class"),
  );
  assert.ok(
    rubySymbols.some(
      (s) => s.name === "build" && s.kind === "method" && s.exported,
    ),
  );
  assert.ok(
    rubySymbols.some(
      (s) => s.name === "_format" && s.kind === "method" && !s.exported,
    ),
  );
  assert.ok(
    rubySymbols.some(
      (s) => s.name === "standalone" && s.kind === "function" && s.exported,
    ),
  );

  const elixirFixture = `
defmodule MyApp.Payment do
  @moduledoc "Payment processing"

  def charge(amount) do
    amount
  end

  defp internal(total) do
    total
  end
end

defmodule MyApp.Gateway do
  def pay(order) do
    order
  end
end
`;
  const elixirSymbols = parseSourceSymbols("payment.ex", elixirFixture);
  assert.ok(
    elixirSymbols.some((s) => s.name === "MyApp.Payment" && s.kind === "class"),
  );
  assert.ok(
    elixirSymbols.some(
      (s) => s.name === "charge" && s.kind === "function" && s.exported,
    ),
  );
  assert.ok(
    elixirSymbols.some(
      (s) => s.name === "internal" && s.kind === "function" && !s.exported,
    ),
  );
  assert.ok(
    elixirSymbols.some((s) => s.name === "MyApp.Gateway" && s.kind === "class"),
  );
});
