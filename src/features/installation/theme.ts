/**
 * Zero-dependency terminal presentation kit for the installation experience.
 *
 * Every helper returns a string; nothing writes to a stream on its own. The
 * caller decides where output goes, which keeps this module pure and testable
 * and keeps stdout reserved for MCP JSON-RPC frames.
 */

export type ColorDepth = "none" | "basic" | "ansi256" | "truecolor";

export interface ThemeCapabilities {
  readonly color: ColorDepth;
  readonly unicode: boolean;
  readonly interactive: boolean;
  readonly width: number;
}

export interface DetectCapabilitiesInput {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly stream?: { readonly isTTY?: boolean; readonly columns?: number };
  readonly platform?: NodeJS.Platform;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const DEFAULT_WIDTH = 80;
const MIN_WIDTH = 40;
const MAX_WIDTH = 100;

/** Cyan → violet: the product accent ramp used for headings and the wordmark. */
export const ACCENT_START: Rgb = { r: 34, g: 211, b: 238 };
export const ACCENT_END: Rgb = { r: 167, g: 139, b: 250 };

const MUTED: Rgb = { r: 148, g: 163, b: 184 };
const SUCCESS: Rgb = { r: 52, g: 211, b: 153 };
const WARNING: Rgb = { r: 251, g: 191, b: 36 };
const DANGER: Rgb = { r: 248, g: 113, b: 113 };

/**
 * Resolves terminal capabilities from the environment.
 *
 * Honors the `NO_COLOR` convention (https://no-color.org) and `FORCE_COLOR`,
 * and falls back to plain ASCII whenever output is not an interactive TTY, so
 * piped and CI output stays free of escape sequences.
 */
export function detectCapabilities(
  input: DetectCapabilitiesInput = {},
): ThemeCapabilities {
  const environment = input.environment ?? {};
  const stream = input.stream ?? {};
  const platform = input.platform ?? "linux";
  const interactive = stream.isTTY === true;

  return {
    color: detectColorDepth(environment, interactive),
    unicode: detectUnicode(environment, platform),
    interactive,
    width: clampWidth(stream.columns),
  };
}

function detectColorDepth(
  environment: Readonly<Record<string, string | undefined>>,
  interactive: boolean,
): ColorDepth {
  if (environment.NO_COLOR !== undefined) {
    return "none";
  }

  const forced = environment.FORCE_COLOR;
  if (forced !== undefined) {
    if (forced === "0" || forced === "false") {
      return "none";
    }
    if (forced === "3") {
      return "truecolor";
    }
    if (forced === "2") {
      return "ansi256";
    }
    return "basic";
  }

  const term = environment.TERM ?? "";
  if (term === "dumb") {
    return "none";
  }
  if (!interactive) {
    return "none";
  }

  const colorTerm = environment.COLORTERM ?? "";
  if (colorTerm === "truecolor" || colorTerm === "24bit") {
    return "truecolor";
  }
  // Windows Terminal and modern VS Code terminals are truecolor capable.
  if (environment.WT_SESSION !== undefined) {
    return "truecolor";
  }
  if (environment.TERM_PROGRAM === "vscode") {
    return "truecolor";
  }
  if (term.includes("256color")) {
    return "ansi256";
  }
  if (term.length > 0) {
    return "basic";
  }
  return "none";
}

function detectUnicode(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "win32") {
    // Legacy conhost mangles box drawing; Windows Terminal and WSL do not.
    return (
      environment.WT_SESSION !== undefined ||
      environment.TERM_PROGRAM === "vscode" ||
      environment.WSL_DISTRO_NAME !== undefined
    );
  }
  const locale =
    environment.LC_ALL ?? environment.LC_CTYPE ?? environment.LANG ?? "";
  if (locale.length === 0) {
    return true;
  }
  return /utf-?8/i.test(locale);
}

function clampWidth(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0) {
    return DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(columns)));
}

interface Glyphs {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
  readonly bullet: string;
  readonly arrow: string;
  readonly success: string;
  readonly warning: string;
  readonly failure: string;
  readonly pending: string;
  readonly spinner: readonly string[];
}

const UNICODE_GLYPHS: Glyphs = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  bullet: "•",
  arrow: "›",
  success: "✔",
  warning: "▲",
  failure: "✘",
  pending: "○",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

const ASCII_GLYPHS: Glyphs = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  bullet: "*",
  arrow: ">",
  success: "OK",
  warning: "!!",
  failure: "XX",
  pending: "..",
  spinner: ["-", "\\", "|", "/"],
};

export interface Theme {
  readonly capabilities: ThemeCapabilities;
  readonly glyphs: Glyphs;
  /** Applies a foreground color, degrading to plain text when unsupported. */
  color(text: string, rgb: Rgb): string;
  bold(text: string): string;
  dim(text: string): string;
  muted(text: string): string;
  accent(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  danger(text: string): string;
  /** Paints a horizontal gradient across the visible characters of `text`. */
  gradient(text: string, from?: Rgb, to?: Rgb): string;
  /** `1.` style step heading with a gradient rule filling the line. */
  section(index: number, total: number, title: string): string;
  rule(width?: number): string;
  /** Rounded panel containing pre-formatted lines. */
  box(lines: readonly string[], title?: string): string;
  status(
    kind: "success" | "warning" | "failure" | "pending",
    text: string,
  ): string;
  keyValue(key: string, value: string, keyWidth?: number): string;
}

export function createTheme(
  capabilities: ThemeCapabilities = detectCapabilities(),
): Theme {
  const glyphs = capabilities.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;
  const hasColor = capabilities.color !== "none";

  const wrap = (text: string, open: string): string =>
    hasColor ? `\x1b[${open}m${text}\x1b[0m` : text;

  const color = (text: string, rgb: Rgb): string => {
    if (!hasColor) {
      return text;
    }
    if (capabilities.color === "truecolor") {
      return wrap(text, `38;2;${rgb.r};${rgb.g};${rgb.b}`);
    }
    if (capabilities.color === "ansi256") {
      return wrap(text, `38;5;${to256(rgb)}`);
    }
    return wrap(text, String(toBasic(rgb)));
  };

  const gradient = (
    text: string,
    from: Rgb = ACCENT_START,
    to: Rgb = ACCENT_END,
  ): string => {
    if (!hasColor) {
      return text;
    }
    const characters = [...text];
    // Only visible characters advance the ramp, so leading indentation does
    // not compress the gradient into the tail of the string.
    const paintable = characters.filter(
      (char) => char.trim().length > 0,
    ).length;
    if (paintable <= 1) {
      return color(text, from);
    }
    let painted = 0;
    let output = "";
    for (const char of characters) {
      if (char.trim().length === 0) {
        output += char;
        continue;
      }
      output += color(char, mix(from, to, painted / (paintable - 1)));
      painted += 1;
    }
    return output;
  };

  const rule = (width: number = capabilities.width): string =>
    gradient(glyphs.horizontal.repeat(Math.max(0, width)));

  const status = (
    kind: "success" | "warning" | "failure" | "pending",
    text: string,
  ): string => {
    const marks = {
      success: [glyphs.success, SUCCESS],
      warning: [glyphs.warning, WARNING],
      failure: [glyphs.failure, DANGER],
      pending: [glyphs.pending, MUTED],
    } as const;
    const [mark, rgb] = marks[kind];
    return `${color(mark, rgb)} ${text}`;
  };

  return {
    capabilities,
    glyphs,
    color,
    gradient,
    rule,
    status,
    bold: (text) => wrap(text, "1"),
    dim: (text) => wrap(text, "2"),
    muted: (text) => color(text, MUTED),
    accent: (text) => color(text, ACCENT_START),
    success: (text) => color(text, SUCCESS),
    warning: (text) => color(text, WARNING),
    danger: (text) => color(text, DANGER),

    section: (index, total, title) => {
      const label = `${index}/${total}`;
      const heading = `${label}  ${title.toUpperCase()}`;
      const used = visibleLength(heading) + 2;
      const fill = Math.max(3, capabilities.width - used);
      return `\n${gradient(heading)} ${color(glyphs.horizontal.repeat(fill), MUTED)}\n`;
    },

    box: (lines, title) => {
      const inner = Math.max(
        visibleLength(title ?? "") + 2,
        ...lines.map((line) => visibleLength(line)),
      );
      const width = Math.min(inner + 2, capabilities.width - 2);
      const top =
        title === undefined
          ? `${glyphs.topLeft}${glyphs.horizontal.repeat(width)}${glyphs.topRight}`
          : `${glyphs.topLeft}${glyphs.horizontal} ${title} ${glyphs.horizontal.repeat(Math.max(0, width - visibleLength(title) - 3))}${glyphs.topRight}`;
      const bottom = `${glyphs.bottomLeft}${glyphs.horizontal.repeat(width)}${glyphs.bottomRight}`;
      const body = lines.map((line) => {
        const padding = Math.max(0, width - visibleLength(line) - 1);
        return `${color(glyphs.vertical, MUTED)} ${line}${" ".repeat(padding)}${color(glyphs.vertical, MUTED)}`;
      });
      return [color(top, MUTED), ...body, color(bottom, MUTED)].join("\n");
    },

    keyValue: (key, value, keyWidth = 22) => {
      const padded = key.padEnd(keyWidth);
      return `  ${color(padded, MUTED)} ${value}`;
    },
  };
}

/** Length of `text` ignoring ANSI escape sequences. */
export function visibleLength(text: string): number {
  return [...stripAnsi(text)].length;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/gu, "");
}

function mix(from: Rgb, to: Rgb, ratio: number): Rgb {
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}

function to256(rgb: Rgb): number {
  const { r, g, b } = rgb;
  if (r === g && g === b) {
    if (r < 8) {
      return 16;
    }
    if (r > 248) {
      return 231;
    }
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return (
    16 +
    36 * Math.round((r / 255) * 5) +
    6 * Math.round((g / 255) * 5) +
    Math.round((b / 255) * 5)
  );
}

function toBasic(rgb: Rgb): number {
  const { r, g, b } = rgb;
  const bright = Math.max(r, g, b) > 128 ? 90 : 30;
  const bit = (value: number): number => (value > 128 ? 1 : 0);
  return bright + (bit(r) | (bit(g) << 1) | (bit(b) << 2));
}

export interface SpinnerHandle {
  /** Replaces the trailing frame with a final status line. */
  stop(finalLine?: string): void;
}

export interface StartSpinnerInput {
  readonly theme: Theme;
  readonly write: (text: string) => void;
  readonly label: string;
  readonly intervalMs?: number;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
}

/**
 * Animated progress indicator for long probes.
 *
 * On a non-interactive stream the label is written once and no timer is
 * created, so scripted and CI runs produce clean, static logs.
 */
export function startSpinner(input: StartSpinnerInput): SpinnerHandle {
  const { theme, write, label } = input;
  if (!theme.capabilities.interactive) {
    write(`${theme.muted(`${theme.glyphs.arrow} ${label}`)}\n`);
    return {
      stop: (finalLine) => (finalLine ? write(`${finalLine}\n`) : undefined),
    };
  }

  const frames = theme.glyphs.spinner;
  const schedule = input.setInterval ?? setInterval;
  const cancel = input.clearInterval ?? clearInterval;
  let frame = 0;
  let stopped = false;

  const render = (): void => {
    const glyph = frames[frame % frames.length] ?? "";
    write(`\r\x1b[2K${theme.accent(glyph)} ${label}`);
    frame += 1;
  };

  render();
  const timer = schedule(render, input.intervalMs ?? 80);
  timer.unref?.();

  return {
    stop: (finalLine) => {
      if (stopped) {
        return;
      }
      stopped = true;
      cancel(timer);
      write("\r\x1b[2K");
      if (finalLine !== undefined) {
        write(`${finalLine}\n`);
      }
    },
  };
}
