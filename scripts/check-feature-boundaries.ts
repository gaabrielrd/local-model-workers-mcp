import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export interface BoundaryViolation {
  file: string;
  importPath: string;
  reason: string;
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return listTypeScriptFiles(path);
      }

      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );

  return files.flat();
}

function sourcePathForImport(importer: string, importPath: string): string {
  const resolvedPath = resolve(dirname(importer), importPath);

  if (extname(resolvedPath) === ".js") {
    return `${resolvedPath.slice(0, -3)}.ts`;
  }

  return extname(resolvedPath).length === 0
    ? join(resolvedPath, "index.ts")
    : resolvedPath;
}

function pathSegments(root: string, path: string): string[] {
  return relative(root, path).split(sep);
}

function inspectImport(
  sourceRoot: string,
  importer: string,
  importPath: string,
): BoundaryViolation | undefined {
  if (!importPath.startsWith(".")) {
    return undefined;
  }

  const importerSegments = pathSegments(sourceRoot, importer);
  const targetSegments = pathSegments(
    sourceRoot,
    sourcePathForImport(importer, importPath),
  );

  if (importerSegments[0] === "shared" && targetSegments[0] === "features") {
    return {
      file: importer,
      importPath,
      reason: "shared code cannot depend on a product feature",
    };
  }

  if (
    importerSegments[0] !== "features" ||
    targetSegments[0] !== "features" ||
    importerSegments[1] === targetSegments[1]
  ) {
    return undefined;
  }

  const targetIsPublicIndex =
    targetSegments.length === 3 && targetSegments[2] === "index.ts";

  if (targetIsPublicIndex) {
    return undefined;
  }

  return {
    file: importer,
    importPath,
    reason: "features must import another feature through its public index.ts",
  };
}

export async function findBoundaryViolations(
  sourceRoot: string,
): Promise<BoundaryViolation[]> {
  const files = await listTypeScriptFiles(sourceRoot);
  const violations: BoundaryViolation[] = [];

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const visit = (node: ts.Node): void => {
      let importPath: string | undefined;

      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        importPath = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1
      ) {
        const firstArgument = node.arguments.at(0);

        if (firstArgument !== undefined && ts.isStringLiteral(firstArgument)) {
          importPath = firstArgument.text;
        }
      }

      if (importPath !== undefined) {
        const violation = inspectImport(sourceRoot, file, importPath);

        if (violation !== undefined) {
          violations.push(violation);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}

const executedPath = process.argv[1];

if (
  executedPath !== undefined &&
  resolve(executedPath) === fileURLToPath(import.meta.url)
) {
  const sourceRoot = resolve("src");
  const violations = await findBoundaryViolations(sourceRoot);

  for (const violation of violations) {
    process.stderr.write(
      `${relative(sourceRoot, violation.file)}: ${violation.importPath}: ${violation.reason}\n`,
    );
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}
