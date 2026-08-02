import process from "node:process";

export interface SelectableOption {
  readonly label: string;
  readonly value: string;
  readonly initiallyChecked?: boolean;
}

export interface CheckboxState {
  readonly options: readonly SelectableOption[];
  readonly checked: readonly boolean[];
  readonly cursor: number;
}

export interface SelectOptionsInput {
  readonly prompt: string;
  readonly options: readonly SelectableOption[];
  readonly write: (text: string) => void;
  readonly input?: NodeJS.ReadableStream;
  readonly interactive?: boolean;
  readonly initial?: readonly string[];
  readonly defaultValues?: readonly string[];
}

export interface SelectOptionsResult {
  readonly values: readonly string[];
  readonly cancelled: boolean;
}

type ParsedKey =
  | {
      readonly kind:
        | "up"
        | "down"
        | "left"
        | "right"
        | "space"
        | "enter"
        | "cancel"
        | "ignore";
      readonly consumed: number;
    }
  | { readonly kind: "incomplete" };

export function createCheckboxState(
  options: readonly SelectableOption[],
  initial?: readonly string[],
): CheckboxState {
  return {
    options,
    checked: options.map(
      (option) =>
        option.initiallyChecked === true ||
        (initial !== undefined && initial.includes(option.value)),
    ),
    cursor: 0,
  };
}

export function moveCheckboxCursor(
  state: CheckboxState,
  delta: number,
): CheckboxState {
  if (state.options.length === 0) {
    return state;
  }
  const cursor =
    (state.cursor + delta + state.options.length) % state.options.length;
  return { ...state, cursor };
}

export function toggleCheckboxOption(
  state: CheckboxState,
  index: number,
): CheckboxState {
  if (index < 0 || index >= state.options.length) {
    return state;
  }
  const checked = [...state.checked];
  checked[index] = !checked[index];
  return { ...state, checked };
}

export function selectedCheckboxValues(
  state: CheckboxState,
): readonly string[] {
  return state.options
    .filter((_option, index) => state.checked[index] === true)
    .map((option) => option.value);
}

export async function selectOptions(
  input: SelectOptionsInput,
): Promise<SelectOptionsResult> {
  if (input.options.length === 0) {
    return { values: [], cancelled: false };
  }
  const state = createCheckboxState(input.options, input.initial);
  if (!isInteractive(input)) {
    return {
      values: input.defaultValues ?? selectedCheckboxValues(state),
      cancelled: false,
    };
  }
  const stream = input.input ?? process.stdin;
  const rawModeEnabled = enableRawMode(stream);
  try {
    return await new Promise<SelectOptionsResult>((resolve) => {
      let current = state;
      let buffer = "";
      let settled = false;
      const finish = (values: readonly string[], cancelled: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        stream.removeListener("data", onData);
        clearBlock(input.write, current.options.length + 1);
        if (cancelled) {
          input.write("Selection cancelled.\n");
        } else {
          input.write(`${input.prompt} ${summarize(values)}\n`);
        }
        resolve({ values, cancelled });
      };
      const onData = (chunk: Buffer | string): void => {
        buffer += chunk.toString("utf8");
        for (;;) {
          const key = parseKey(buffer);
          if (key.kind === "incomplete") {
            return;
          }
          buffer = buffer.slice(key.consumed);
          switch (key.kind) {
            case "up":
              current = moveCheckboxCursor(current, -1);
              break;
            case "down":
              current = moveCheckboxCursor(current, 1);
              break;
            case "space":
              current = toggleCheckboxOption(current, current.cursor);
              break;
            case "enter":
              finish(selectedCheckboxValues(current), false);
              return;
            case "cancel":
              finish([], true);
              return;
            case "left":
            case "right":
            case "ignore":
              break;
          }
          redrawBlock(input.write, current, input.prompt);
        }
      };
      renderBlock(input.write, current, input.prompt);
      stream.on("data", onData);
    });
  } finally {
    disableRawMode(stream, rawModeEnabled);
  }
}

function isInteractive(input: SelectOptionsInput): boolean {
  if (input.interactive !== undefined) {
    return input.interactive;
  }
  const stream = (input.input ?? process.stdin) as NodeJS.ReadableStream & {
    isTTY?: boolean;
  };
  return stream.isTTY === true;
}

function enableRawMode(stream: NodeJS.ReadableStream): boolean {
  const withRaw = stream as NodeJS.ReadableStream & {
    setRawMode?: (mode: boolean) => unknown;
  };
  if (typeof withRaw.setRawMode === "function") {
    withRaw.setRawMode(true);
    return true;
  }
  return false;
}

function disableRawMode(stream: NodeJS.ReadableStream, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  const withRaw = stream as NodeJS.ReadableStream & {
    setRawMode?: (mode: boolean) => unknown;
  };
  withRaw.setRawMode?.(false);
}

function renderBlock(
  write: (text: string) => void,
  state: CheckboxState,
  prompt: string,
): void {
  write(`${prompt}\r\n`);
  for (let index = 0; index < state.options.length; index += 1) {
    write(`${optionLine(state, index)}\r\n`);
  }
}

function redrawBlock(
  write: (text: string) => void,
  state: CheckboxState,
  prompt: string,
): void {
  const height = state.options.length + 1;
  write(`\x1b[${height}A`);
  write(`\x1b[2K${prompt}\r\n`);
  for (let index = 0; index < state.options.length; index += 1) {
    write(`\x1b[2K${optionLine(state, index)}\r\n`);
  }
}

function clearBlock(write: (text: string) => void, height: number): void {
  write(`\x1b[${height}A`);
  write("\x1b[2K\r\n");
  for (let index = 1; index < height; index += 1) {
    write("\x1b[2K\r\n");
  }
  if (height > 1) {
    write(`\x1b[${height - 1}A`);
  }
}

function optionLine(state: CheckboxState, index: number): string {
  const cursor = index === state.cursor ? "\u203a" : " ";
  const box = state.checked[index] === true ? "[x]" : "[ ]";
  return `${cursor} ${box} ${state.options[index]?.label ?? ""}`;
}

function summarize(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function parseKey(buffer: string): ParsedKey {
  if (buffer.length === 0) {
    return { kind: "incomplete" };
  }
  const first = buffer.charCodeAt(0);
  if (first === 13 || first === 10) {
    return { kind: "enter", consumed: 1 };
  }
  if (first === 32) {
    return { kind: "space", consumed: 1 };
  }
  if (first === 3) {
    return { kind: "cancel", consumed: 1 };
  }
  if (first === 27) {
    if (buffer.length === 1) {
      return { kind: "incomplete" };
    }
    if (buffer[1] === "[") {
      if (buffer.length < 3) {
        return { kind: "incomplete" };
      }
      const code = buffer.charCodeAt(2);
      if (code === 65) {
        return { kind: "up", consumed: 3 };
      }
      if (code === 66) {
        return { kind: "down", consumed: 3 };
      }
      if (code === 67) {
        return { kind: "right", consumed: 3 };
      }
      if (code === 68) {
        return { kind: "left", consumed: 3 };
      }
      return { kind: "ignore", consumed: 3 };
    }
    return { kind: "ignore", consumed: 2 };
  }
  return { kind: "ignore", consumed: 1 };
}
