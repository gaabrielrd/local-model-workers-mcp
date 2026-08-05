import assert from "node:assert/strict";
import test from "node:test";

import { renderBanner } from "../src/features/installation/banner.js";
import {
  createTheme,
  detectCapabilities,
  startSpinner,
  stripAnsi,
  visibleLength,
  type ThemeCapabilities,
} from "../src/features/installation/theme.js";

const TTY = { isTTY: true, columns: 80 } as const;

/** Built at runtime so the literal control character stays out of the source. */
const ESC = String.fromCharCode(27);

function ansiPattern(body: string): RegExp {
  return new RegExp(`${ESC}\\[${body}`, "u");
}

function countAnsiRuns(text: string, body: string): number {
  return text.split(`${ESC}[${body}`).length - 1;
}

void test("NO_COLOR disables color regardless of terminal capability", () => {
  const capabilities = detectCapabilities({
    environment: {
      NO_COLOR: "1",
      COLORTERM: "truecolor",
      TERM: "xterm-256color",
    },
    stream: TTY,
  });
  assert.equal(capabilities.color, "none");
});

void test("an empty NO_COLOR value still disables color", () => {
  const capabilities = detectCapabilities({
    environment: { NO_COLOR: "", COLORTERM: "truecolor" },
    stream: TTY,
  });
  assert.equal(capabilities.color, "none");
});

void test("FORCE_COLOR selects an explicit depth and overrides a non-TTY stream", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["0", "none"],
    ["false", "none"],
    ["1", "basic"],
    ["2", "ansi256"],
    ["3", "truecolor"],
  ];
  for (const [value, expected] of cases) {
    const capabilities = detectCapabilities({
      environment: { FORCE_COLOR: value },
      stream: { isTTY: false },
    });
    assert.equal(capabilities.color, expected, `FORCE_COLOR=${value}`);
  }
});

void test("a non-TTY stream receives no color", () => {
  const capabilities = detectCapabilities({
    environment: { COLORTERM: "truecolor", TERM: "xterm-256color" },
    stream: { isTTY: false },
  });
  assert.equal(capabilities.color, "none");
  assert.equal(capabilities.interactive, false);
});

void test("TERM=dumb receives no color even on a TTY", () => {
  const capabilities = detectCapabilities({
    environment: { TERM: "dumb" },
    stream: TTY,
  });
  assert.equal(capabilities.color, "none");
});

void test("color depth degrades from truecolor to basic by terminal signal", () => {
  assert.equal(
    detectCapabilities({ environment: { COLORTERM: "24bit" }, stream: TTY })
      .color,
    "truecolor",
  );
  assert.equal(
    detectCapabilities({ environment: { WT_SESSION: "x" }, stream: TTY }).color,
    "truecolor",
  );
  assert.equal(
    detectCapabilities({ environment: { TERM: "xterm-256color" }, stream: TTY })
      .color,
    "ansi256",
  );
  assert.equal(
    detectCapabilities({ environment: { TERM: "xterm" }, stream: TTY }).color,
    "basic",
  );
  assert.equal(
    detectCapabilities({ environment: {}, stream: TTY }).color,
    "none",
  );
});

void test("legacy Windows consoles fall back to ASCII glyphs", () => {
  assert.equal(
    detectCapabilities({ environment: {}, platform: "win32", stream: TTY })
      .unicode,
    false,
  );
  assert.equal(
    detectCapabilities({
      environment: { WT_SESSION: "x" },
      platform: "win32",
      stream: TTY,
    }).unicode,
    true,
  );
});

void test("a non-UTF-8 locale falls back to ASCII glyphs", () => {
  assert.equal(
    detectCapabilities({
      environment: { LANG: "en_US.ISO-8859-1" },
      stream: TTY,
    }).unicode,
    false,
  );
  assert.equal(
    detectCapabilities({ environment: { LANG: "en_US.UTF-8" }, stream: TTY })
      .unicode,
    true,
  );
  assert.equal(
    detectCapabilities({ environment: {}, stream: TTY }).unicode,
    true,
  );
});

void test("terminal width is clamped into a readable range", () => {
  assert.equal(detectCapabilities({ stream: { columns: 10 } }).width, 40);
  assert.equal(detectCapabilities({ stream: { columns: 400 } }).width, 100);
  assert.equal(detectCapabilities({ stream: { columns: 72 } }).width, 72);
  assert.equal(detectCapabilities({ stream: {} }).width, 80);
});

void test("a colorless theme emits no escape sequences", () => {
  const theme = createTheme(capabilities({ color: "none" }));
  const rendered = [
    theme.bold("bold"),
    theme.accent("accent"),
    theme.gradient("gradient"),
    theme.section(1, 3, "step"),
    theme.status("success", "done"),
    theme.box(["line"], "title"),
  ].join("");
  assert.equal(rendered.includes(`${ESC}[`), false);
});

void test("truecolor gradient paints each visible character and skips whitespace", () => {
  const theme = createTheme(capabilities({ color: "truecolor" }));
  const painted = theme.gradient("ab c");
  assert.equal(stripAnsi(painted), "ab c");
  // Three visible characters produce three color runs; the space is untouched.
  assert.equal(countAnsiRuns(painted, "38;2;"), 3);
});

void test("gradient of a single character uses the start color without dividing by zero", () => {
  const theme = createTheme(capabilities({ color: "truecolor" }));
  const painted = theme.gradient("x");
  assert.equal(stripAnsi(painted), "x");
  assert.match(painted, /38;2;34;211;238/u);
});

void test("ansi256 and basic depths use their own escape forms", () => {
  assert.match(
    createTheme(capabilities({ color: "ansi256" })).accent("x"),
    ansiPattern("38;5;\\d+m"),
  );
  assert.match(
    createTheme(capabilities({ color: "basic" })).accent("x"),
    ansiPattern("\\d{2}m"),
  );
});

void test("ASCII capabilities swap unicode glyphs for portable markers", () => {
  const theme = createTheme(capabilities({ unicode: false, color: "none" }));
  assert.equal(theme.status("success", "ok"), "OK ok");
  assert.equal(theme.status("failure", "no"), "XX no");
  assert.match(theme.box(["x"]), /^\+-+\+/u);
});

void test("box borders align across the title, body, and footer rows", () => {
  const theme = createTheme(capabilities({ color: "none", unicode: false }));
  const lines = theme
    .box(["short", "a much longer body line"], "Title")
    .split("\n");
  const widths = new Set(lines.map((line) => visibleLength(line)));
  assert.equal(
    widths.size,
    1,
    `rows must share one width, saw ${[...widths].join(", ")}`,
  );
});

void test("visibleLength ignores styling when measuring", () => {
  const theme = createTheme(capabilities({ color: "truecolor" }));
  assert.equal(visibleLength(theme.accent("12345")), 5);
  assert.equal(visibleLength(theme.gradient("12345")), 5);
});

void test("the spinner writes a single static line off-TTY and never starts a timer", () => {
  const written: string[] = [];
  let scheduled = 0;
  const handle = startSpinner({
    theme: createTheme(
      capabilities({ interactive: false, color: "none", unicode: false }),
    ),
    write: (text) => written.push(text),
    label: "probing",
    setInterval: () => {
      scheduled += 1;
      return 0 as unknown as NodeJS.Timeout;
    },
  });
  handle.stop("done");

  assert.equal(scheduled, 0);
  assert.deepEqual(written, ["> probing\n", "done\n"]);
});

void test("the spinner animates on a TTY and clears itself when stopped", () => {
  const written: string[] = [];
  let tick: (() => void) | undefined;
  let cleared = 0;
  const handle = startSpinner({
    theme: createTheme(capabilities({ interactive: true, color: "none" })),
    write: (text) => written.push(text),
    label: "probing",
    setInterval: (callback: () => void) => {
      tick = callback;
      return { unref: () => undefined } as unknown as NodeJS.Timeout;
    },
    clearInterval: () => {
      cleared += 1;
    },
  });

  tick?.();
  handle.stop("finished");
  handle.stop("ignored second stop");

  assert.equal(cleared, 1);
  assert.equal(written.at(-1), "finished\n");
  assert.equal(
    written.filter((entry) => entry.includes("probing")).length >= 2,
    true,
  );
});

void test("the banner collapses to one identifying line when not interactive", () => {
  const theme = createTheme(
    capabilities({ interactive: false, color: "none" }),
  );
  const banner = renderBanner({ theme, subtitle: "Setup" });
  assert.equal(banner.includes("\x1b["), false);
  assert.match(banner, /local-model-workers-mcp/u);
  assert.match(banner, /Setup/u);
  assert.equal(banner.trimEnd().split("\n").length, 1);
});

void test("the interactive banner renders the wordmark and degrades to ASCII art", () => {
  const unicode = renderBanner({
    theme: createTheme(capabilities({ interactive: true, color: "truecolor" })),
  });
  assert.match(stripAnsi(unicode), /█/u);
  assert.match(stripAnsi(unicode), /Local Model Workers/u);

  const ascii = renderBanner({
    theme: createTheme(
      capabilities({ interactive: true, color: "basic", unicode: false }),
    ),
  });
  assert.equal(stripAnsi(ascii).includes("█"), false);
  assert.match(stripAnsi(ascii), /\|_____\|/u);
});

function capabilities(
  overrides: Partial<ThemeCapabilities> = {},
): ThemeCapabilities {
  return {
    color: "truecolor",
    unicode: true,
    interactive: true,
    width: 80,
    ...overrides,
  };
}
