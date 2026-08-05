import type { ResultVerbosity } from "../configuration/index.js";

const TERSE_DROP_KEYS = new Set([
  "risks",
  "next_steps",
  "limitation_impact",
  "architectural_notes",
]);

const TERSE_ARRAY_ITEM_DROP_KEYS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  evidence: new Set(["explanation"]),
  attempts: new Set(["patch"]),
};

export interface RenderedToolResult {
  readonly content: { type: "text"; text: string }[];
  readonly structuredContent: Record<string, unknown>;
}

export function renderToolResult(
  structured: Record<string, unknown>,
  verbosity: ResultVerbosity,
): RenderedToolResult {
  const payload =
    verbosity === "terse" ? compactTerseResult(structured) : structured;
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function compactTerseResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return compactObject(value);
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (TERSE_DROP_KEYS.has(key)) {
      continue;
    }
    const itemDropKeys = TERSE_ARRAY_ITEM_DROP_KEYS[key];
    if (itemDropKeys !== undefined && Array.isArray(item)) {
      output[key] = item.map((entry) => compactEntry(entry, itemDropKeys));
      continue;
    }
    output[key] = compactValue(item);
  }
  return output;
}

function compactEntry(
  value: unknown,
  droppedKeys: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compactEntry(entry, droppedKeys));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (droppedKeys.has(key)) {
      continue;
    }
    output[key] = compactValue(item);
  }
  return output;
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return compactObject(value as Record<string, unknown>);
}
