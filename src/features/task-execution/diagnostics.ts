import {
  DiagnosticSchema,
  type Diagnostic,
  type DiagnosticIssue,
  type ErrorCode,
  type LocalizedText,
} from "./contracts.js";

export const REDACTED_TEXT = "[REDACTED]";

export interface DiagnosticInput {
  code: ErrorCode;
  message: LocalizedText;
  issues?: readonly DiagnosticIssue[];
}

interface RedactionResult {
  text: string;
  count: number;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function redactText(text: string, secrets: readonly string[]): RedactionResult {
  if (secrets.length === 0) {
    return { count: 0, text };
  }

  const secretPattern = new RegExp(
    secrets.map(escapeRegularExpression).join("|"),
    "gu",
  );
  let count = 0;

  const redactedText = text.replace(secretPattern, () => {
    count += 1;
    return REDACTED_TEXT;
  });

  return { count, text: redactedText };
}

export function createDiagnostic(
  input: DiagnosticInput,
  secretValues: readonly string[] = [],
): Diagnostic {
  const secrets = [...new Set(secretValues)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
  const message = redactText(input.message.text, secrets);
  let redactionCount = message.count;

  const issues = (input.issues ?? []).map((issue) => {
    const issueMessage = redactText(issue.message.text, secrets);
    redactionCount += issueMessage.count;

    return {
      ...issue,
      message: {
        ...issue.message,
        text: issueMessage.text,
      },
    };
  });

  return DiagnosticSchema.parse({
    code: input.code,
    message: {
      ...input.message,
      text: message.text,
    },
    issues,
    redaction_count: redactionCount,
  });
}
