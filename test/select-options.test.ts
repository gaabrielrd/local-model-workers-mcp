import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createCheckboxState,
  moveCheckboxCursor,
  selectOptions,
  selectedCheckboxValues,
  toggleCheckboxOption,
} from "../src/features/installation/index.js";

const harnessOptions = [
  { label: "Claude Code", value: "claude-code", initiallyChecked: true },
  { label: "Codex", value: "codex" },
  { label: "Antigravity", value: "antigravity" },
];

void test("creates checkbox state honoring initial and initiallyChecked", () => {
  const state = createCheckboxState(harnessOptions, ["codex"]);
  assert.deepEqual(state.checked, [true, true, false]);
  assert.equal(state.cursor, 0);

  const empty = createCheckboxState([], ["anything"]);
  assert.deepEqual(empty.checked, []);
});

void test("moves cursor with wrapping and ignores out-of-range toggles", () => {
  const state = createCheckboxState(harnessOptions);
  assert.equal(moveCheckboxCursor(state, -1).cursor, 2);
  assert.equal(moveCheckboxCursor(state, 1).cursor, 1);
  assert.equal(moveCheckboxCursor(state, 4).cursor, 1);
  assert.equal(toggleCheckboxOption(state, 99), state);

  const empty = createCheckboxState([]);
  assert.equal(moveCheckboxCursor(empty, 1), empty);
});

void test("toggles an option on and off", () => {
  const state = createCheckboxState([
    { label: "A", value: "a" },
    { label: "B", value: "b" },
  ]);
  const on = toggleCheckboxOption(state, 1);
  assert.deepEqual(on.checked, [false, true]);
  const off = toggleCheckboxOption(on, 1);
  assert.deepEqual(off.checked, [false, false]);
});

void test("collects selected values in order", () => {
  const state = createCheckboxState(
    [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
      { label: "C", value: "c" },
    ],
    ["b", "c"],
  );
  assert.deepEqual(selectedCheckboxValues(state), ["b", "c"]);
});

void test("selectOptions non-interactive honors defaults and initial selection", async () => {
  const write: string[] = [];
  const base = {
    prompt: "Pick harnesses:",
    options: harnessOptions,
    write: (text: string): void => {
      write.push(text);
    },
  };
  const withDefaults = await selectOptions({
    ...base,
    interactive: false,
    defaultValues: ["codex"],
  });
  assert.deepEqual(withDefaults, { values: ["codex"], cancelled: false });
  const withoutDefaults = await selectOptions({
    ...base,
    interactive: false,
    initial: ["claude-code", "antigravity"],
  });
  assert.deepEqual(withoutDefaults.values, ["claude-code", "antigravity"]);
  assert.deepEqual(write, []);
  assert.deepEqual(await selectOptions({ ...base, options: [] }), {
    values: [],
    cancelled: false,
  });
});

function createTtyStream(): PassThrough & {
  isTTY: true;
  setRawMode: (mode: boolean) => void;
} {
  const stream = new PassThrough();
  Object.assign(stream, {
    isTTY: true,
    rawModeHistory: [] as boolean[],
    setRawMode: function setRawMode(this: PassThrough, mode: boolean): void {
      (this as unknown as { rawModeHistory: boolean[] }).rawModeHistory.push(
        mode,
      );
    },
  });
  return stream as PassThrough & {
    isTTY: true;
    setRawMode: (mode: boolean) => void;
  };
}

void test("selectOptions interactive toggles with arrows and space and confirms with enter", async () => {
  const stream = createTtyStream();
  const write: string[] = [];
  const promise = selectOptions({
    prompt: "Pick harnesses:",
    options: harnessOptions,
    write: (text: string): void => {
      write.push(text);
    },
    input: stream,
  });
  stream.write("\x1b[B");
  stream.write(" ");
  stream.write("\x1b[B");
  stream.write(" ");
  stream.write("\r");
  const result = await promise;
  assert.deepEqual(result, {
    values: ["claude-code", "codex", "antigravity"],
    cancelled: false,
  });
  assert.deepEqual(
    (stream as unknown as { rawModeHistory: boolean[] }).rawModeHistory,
    [true, false],
  );
  assert.match(write.join(""), /Pick harnesses:/);
  assert.match(write.join(""), /Claude Code/);
  assert.match(write.join(""), /claude-code/);
});

void test("selectOptions interactive buffers partial escape sequences", async () => {
  const stream = createTtyStream();
  const promise = selectOptions({
    prompt: "Pick harnesses:",
    options: harnessOptions,
    write: (): void => undefined,
    input: stream,
  });
  stream.write("\x1b");
  stream.write("[B");
  stream.write(" ");
  stream.write("\n");
  const result = await promise;
  assert.deepEqual(result.values, ["claude-code", "codex"]);
});

void test("selectOptions interactive cancels on ctrl-c returning no values", async () => {
  const stream = createTtyStream();
  const promise = selectOptions({
    prompt: "Pick harnesses:",
    options: harnessOptions,
    write: (): void => undefined,
    input: stream,
  });
  stream.write("\x03");
  const result = await promise;
  assert.deepEqual(result, { values: [], cancelled: true });
});
