import type { CodeSymbol } from "./contracts.js";

export function parseSourceSymbols(
  filePath: string,
  content: string,
): readonly CodeSymbol[] {
  const isPython = filePath.endsWith(".py");
  const isTypeScript =
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx");
  const isGo = filePath.endsWith(".go");
  const isRust = filePath.endsWith(".rs");
  const isJava = filePath.endsWith(".java");
  const isCSharp = filePath.endsWith(".cs");

  if (!isPython && !isTypeScript && !isGo && !isRust && !isJava && !isCSharp) {
    return [];
  }

  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNum = i + 1;
    const rawLine = lines[i]!;
    const line = rawLine.trim();

    if (
      line.length === 0 ||
      line.startsWith("//") ||
      line.startsWith("#") ||
      line.startsWith("/*")
    ) {
      continue;
    }

    if (isTypeScript) {
      parseTypeScriptLine(filePath, line, lineNum, lines, symbols);
    } else if (isPython) {
      parsePythonLine(filePath, rawLine, line, lineNum, lines, symbols);
    } else if (isGo) {
      parseGoLine(filePath, line, lineNum, lines, symbols);
    } else if (isRust) {
      parseRustLine(filePath, line, lineNum, lines, symbols);
    } else if (isJava) {
      parseJavaLine(filePath, line, lineNum, lines, symbols);
    } else if (isCSharp) {
      parseCSharpLine(filePath, line, lineNum, lines, symbols);
    }
  }

  return symbols;
}

function parseTypeScriptLine(
  filePath: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  const isExported = line.startsWith("export ");
  const declLine = isExported
    ? line.replace(/^export\s+(default\s+)?/u, "")
    : line;

  // Function declaration
  const funcMatch = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/u.exec(declLine);
  if (funcMatch?.[1] !== undefined) {
    symbols.push({
      name: funcMatch[1],
      kind: "function",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  // Const function expression
  const constFuncMatch =
    /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/u.exec(
      declLine,
    );
  if (constFuncMatch?.[1] !== undefined) {
    symbols.push({
      name: constFuncMatch[1],
      kind: "function",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  // Class declaration
  const classMatch = /^class\s+([A-Za-z0-9_$]+)/u.exec(declLine);
  if (classMatch?.[1] !== undefined) {
    symbols.push({
      name: classMatch[1],
      kind: "class",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  // Interface declaration
  const interfaceMatch = /^interface\s+([A-Za-z0-9_$]+)/u.exec(declLine);
  if (interfaceMatch?.[1] !== undefined) {
    symbols.push({
      name: interfaceMatch[1],
      kind: "interface",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  // Type alias declaration
  const typeMatch = /^type\s+([A-Za-z0-9_$]+)\s*=/u.exec(declLine);
  if (typeMatch?.[1] !== undefined) {
    symbols.push({
      name: typeMatch[1],
      kind: "type_alias",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: isExported,
    });
    return;
  }

  // Imports
  const importMatch = /^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/u.exec(
    line,
  );
  if (importMatch?.[1] !== undefined) {
    symbols.push({
      name: importMatch[1],
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
    return;
  }

  // Pure Export statement (re-export or named export)
  if (
    isExported &&
    (line.startsWith("export {") || line.startsWith("export *"))
  ) {
    symbols.push({
      name: line,
      kind: "export",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: true,
    });
  }
}

function parsePythonLine(
  filePath: string,
  rawLine: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  // Python function or method declaration
  const defMatch = /^(?:\s*)def\s+([A-Za-z0-9_]+)\s*\(/u.exec(line);
  if (defMatch?.[1] !== undefined) {
    const isMethod = rawLine.startsWith("    ") || rawLine.startsWith("\t");
    const name = defMatch[1];
    symbols.push({
      name,
      kind: isMethod ? "method" : "function",
      filePath,
      startLine: lineNum,
      endLine: estimatePythonEndLine(lineNum, lines),
      signature: line,
      exported: !name.startsWith("_"),
    });
    return;
  }

  // Python class declaration
  const classMatch = /^(?:\s*)class\s+([A-Za-z0-9_]+)/u.exec(line);
  if (classMatch?.[1] !== undefined) {
    const name = classMatch[1];
    symbols.push({
      name,
      kind: "class",
      filePath,
      startLine: lineNum,
      endLine: estimatePythonEndLine(lineNum, lines),
      signature: line,
      exported: !name.startsWith("_"),
    });
    return;
  }

  // Python import
  const importMatch =
    /^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/u.exec(
      line,
    );
  if (importMatch !== null) {
    const moduleName = importMatch[1] ?? importMatch[2] ?? line;
    symbols.push({
      name: moduleName,
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
  }
}

function estimateEndLine(
  startLine: number,
  lines: readonly string[],
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  let foundOpen = false;

  for (let i = startLine - 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const char of line) {
      if (char === openChar) {
        depth += 1;
        foundOpen = true;
      } else if (char === closeChar) {
        depth -= 1;
        if (foundOpen && depth === 0) {
          return i + 1;
        }
      }
    }
  }
  return startLine;
}

function estimatePythonEndLine(
  startLine: number,
  lines: readonly string[],
): number {
  const startIndent = getIndentLevel(lines[startLine - 1] ?? "");
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const currentIndent = getIndentLevel(line);
    if (currentIndent <= startIndent) {
      return i;
    }
  }
  return lines.length;
}

function getIndentLevel(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === " ") {
      count += 1;
    } else if (char === "\t") {
      count += 4;
    } else {
      break;
    }
  }
  return count;
}

function parseGoLine(
  filePath: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  const funcMatch = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/u.exec(line);
  if (funcMatch?.[1] !== undefined) {
    const name = funcMatch[1];
    const isExported = /^[A-Z]/u.test(name);
    symbols.push({
      name,
      kind: "function",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const typeMatch =
    /^type\s+([A-Za-z0-9_]+)\s+(struct|interface|[A-Za-z0-9_]+)/u.exec(line);
  if (typeMatch?.[1] !== undefined) {
    const name = typeMatch[1];
    const rawKind = typeMatch[2] ?? "type_alias";
    const kind =
      rawKind === "struct"
        ? "class"
        : rawKind === "interface"
          ? "interface"
          : "type_alias";
    const isExported = /^[A-Z]/u.test(name);
    symbols.push({
      name,
      kind,
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const importMatch = /^import\s+(?:["']([^"']+)["']|\()/u.exec(line);
  if (importMatch !== null) {
    symbols.push({
      name: importMatch[1] ?? line,
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
  }
}

function parseRustLine(
  filePath: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  const isPublic = line.startsWith("pub ");
  const declLine = isPublic ? line.replace(/^pub(?:\([^)]+\))?\s+/u, "") : line;

  const fnMatch = /^fn\s+([A-Za-z0-9_]+)/u.exec(declLine);
  if (fnMatch?.[1] !== undefined) {
    symbols.push({
      name: fnMatch[1],
      kind: "function",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isPublic,
    });
    return;
  }

  const structMatch = /^(struct|enum|trait)\s+([A-Za-z0-9_]+)/u.exec(declLine);
  if (structMatch?.[2] !== undefined) {
    const rawKind = structMatch[1];
    const kind =
      rawKind === "struct"
        ? "class"
        : rawKind === "trait"
          ? "interface"
          : "type_alias";
    symbols.push({
      name: structMatch[2],
      kind,
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isPublic,
    });
    return;
  }

  const typeMatch = /^type\s+([A-Za-z0-9_]+)/u.exec(declLine);
  if (typeMatch?.[1] !== undefined) {
    symbols.push({
      name: typeMatch[1],
      kind: "type_alias",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: isPublic,
    });
    return;
  }

  const useMatch = /^use\s+([^;]+)/u.exec(line);
  if (useMatch?.[1] !== undefined) {
    symbols.push({
      name: useMatch[1].trim(),
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
  }
}

function parseJavaLine(
  filePath: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  const isExported = /\b(public|protected)\b/u.test(line);

  const classMatch =
    /(?:public|protected|private|abstract|final|static\s+)*(class|interface|enum)\s+([A-Za-z0-9_]+)/u.exec(
      line,
    );
  if (classMatch?.[2] !== undefined) {
    const rawKind = classMatch[1];
    const kind =
      rawKind === "class"
        ? "class"
        : rawKind === "interface"
          ? "interface"
          : "type_alias";
    symbols.push({
      name: classMatch[2],
      kind,
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const methodMatch =
    /(?:(?:public|protected|private|static|final|synchronized|abstract)\s+)+[A-Za-z0-9_<>[\]]+\s+([A-Za-z0-9_]+)\s*\(/u.exec(
      line,
    );
  if (methodMatch?.[1] !== undefined) {
    symbols.push({
      name: methodMatch[1],
      kind: "method",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const importMatch = /^import\s+([^;]+)/u.exec(line);
  if (importMatch?.[1] !== undefined) {
    symbols.push({
      name: importMatch[1].trim(),
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
  }
}

function parseCSharpLine(
  filePath: string,
  line: string,
  lineNum: number,
  lines: readonly string[],
  symbols: CodeSymbol[],
): void {
  const isExported = /\b(public|protected)\b/u.test(line);

  const classMatch =
    /(?:public|protected|private|internal|abstract|sealed|static\s+)*(class|interface|struct|record)\s+([A-Za-z0-9_]+)/u.exec(
      line,
    );
  if (classMatch?.[2] !== undefined) {
    const rawKind = classMatch[1];
    const kind =
      rawKind === "class" || rawKind === "struct" || rawKind === "record"
        ? "class"
        : "interface";
    symbols.push({
      name: classMatch[2],
      kind,
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const methodMatch =
    /(?:(?:public|protected|private|internal|static|async|virtual|override|abstract)\s+)+[A-Za-z0-9_<>[\]?]+\s+([A-Za-z0-9_]+)\s*\(/u.exec(
      line,
    );
  if (methodMatch?.[1] !== undefined) {
    symbols.push({
      name: methodMatch[1],
      kind: "method",
      filePath,
      startLine: lineNum,
      endLine: estimateEndLine(lineNum, lines, "{", "}"),
      signature: line,
      exported: isExported,
    });
    return;
  }

  const usingMatch = /^using\s+([^;]+)/u.exec(line);
  if (usingMatch?.[1] !== undefined) {
    symbols.push({
      name: usingMatch[1].trim(),
      kind: "import",
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      signature: line,
      exported: false,
    });
  }
}
