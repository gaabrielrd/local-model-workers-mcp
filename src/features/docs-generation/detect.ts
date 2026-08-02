import type { CodeSymbol } from "../code-graph/index.js";
import { parseSourceSymbols } from "../code-graph/index.js";

import type {
  DocStyle,
  DocumentableFile,
  SourceLanguage,
  UndocumentedSymbol,
} from "./contracts.js";

const TYPESCRIPT_STYLES: readonly DocStyle[] = ["jsdoc", "tsdoc"];
const PYTHON_STYLES: readonly DocStyle[] = ["numpy", "google"];

export function detectDocumentableFile(
  filePath: string,
  content: string,
  requestedStyle?: DocStyle,
  forceRefresh = false,
): DocumentableFile {
  const language = languageOf(filePath);
  const style =
    requestedStyle !== undefined && styleMatches(requestedStyle, language)
      ? requestedStyle
      : defaultStyle(language);
  const symbols = parseSourceSymbols(filePath, content);
  const publicSymbols = symbols.filter(
    (symbol) =>
      symbol.exported && symbol.kind !== "import" && symbol.kind !== "export",
  );
  const selected = forceRefresh
    ? publicSymbols
    : publicSymbols.filter(
        (symbol) => !hasDocumentation(content, language, symbol),
      );
  return {
    path: filePath,
    language,
    style,
    symbols: selected.map(toUndocumentedSymbol),
  };
}

export function isDocumentableCodeFile(filePath: string): boolean {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx") ||
    filePath.endsWith(".py")
  );
}

function languageOf(filePath: string): SourceLanguage {
  return filePath.endsWith(".py") ? "python" : "typescript";
}

function defaultStyle(language: SourceLanguage): DocStyle {
  return language === "python" ? "google" : "jsdoc";
}

function styleMatches(style: DocStyle, language: SourceLanguage): boolean {
  return language === "python"
    ? PYTHON_STYLES.includes(style)
    : TYPESCRIPT_STYLES.includes(style);
}

function toUndocumentedSymbol(symbol: CodeSymbol): UndocumentedSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    signature: symbol.signature,
    start_line: symbol.startLine,
    end_line: symbol.endLine,
  };
}

function hasDocumentation(
  content: string,
  language: SourceLanguage,
  symbol: CodeSymbol,
): boolean {
  const lines = content.split("\n");
  return language === "python"
    ? hasPythonDocstring(lines, symbol.startLine)
    : hasTypeScriptCommentAbove(lines, symbol.startLine);
}

function hasPythonDocstring(
  lines: readonly string[],
  startLine: number,
): boolean {
  const line = lines[startLine]?.trim();
  if (line === undefined || line.length === 0) {
    return false;
  }
  return (
    line.startsWith('"""') ||
    line.startsWith("'''") ||
    line.startsWith('"') ||
    line.startsWith("'")
  );
}

function hasTypeScriptCommentAbove(
  lines: readonly string[],
  startLine: number,
): boolean {
  for (let index = startLine - 2; index >= 0; index -= 1) {
    const trimmed = lines[index]?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      continue;
    }
    return trimmed.includes("*/");
  }
  return false;
}
