import { PACKAGE_INFO } from "../../shared/package-info.js";

import { visibleLength, type Theme } from "./theme.js";

/** "LMW" monogram in block characters, painted with the accent gradient. */
const WORDMARK = [
  "██╗     ███╗   ███╗██╗    ██╗",
  "██║     ████╗ ████║██║    ██║",
  "██║     ██╔████╔██║██║ █╗ ██║",
  "██║     ██║╚██╔╝██║██║███╗██║",
  "███████╗██║ ╚═╝ ██║╚███╔███╔╝",
  "╚══════╝╚═╝     ╚═╝ ╚══╝╚══╝ ",
] as const;

const ASCII_WORDMARK = [
  " _     __  __ __        __",
  "| |   |  \\/  |\\ \\      / /",
  "| |   | |\\/| | \\ \\ /\\ / / ",
  "| |___| |  | |  \\ V  V /  ",
  "|_____|_|  |_|   \\_/\\_/   ",
] as const;

const TAGLINE = "Heavy repository work on your own models.";

export interface BannerInput {
  readonly theme: Theme;
  /** Short line describing the running command, shown under the wordmark. */
  readonly subtitle?: string;
}

/**
 * Renders the product banner.
 *
 * On a plain or non-interactive terminal this collapses to a single
 * identifying line so logs and CI transcripts stay readable.
 */
export function renderBanner(input: BannerInput): string {
  const { theme, subtitle } = input;
  const { capabilities } = theme;

  if (!capabilities.interactive || capabilities.color === "none") {
    const suffix = subtitle === undefined ? "" : ` — ${subtitle}`;
    return `${PACKAGE_INFO.name} ${PACKAGE_INFO.version}${suffix}\n`;
  }

  const art = capabilities.unicode ? WORDMARK : ASCII_WORDMARK;
  const lines = art.map((line) => `  ${theme.gradient(line)}`);

  const width = Math.max(...art.map((line) => visibleLength(line)));
  const version = theme.muted(`v${PACKAGE_INFO.version}`);
  const title = `${theme.bold("Local Model Workers")} ${version}`;
  const tagline = theme.muted(TAGLINE);

  const footer = [
    "",
    `  ${title}`,
    `  ${tagline}`,
    ...(subtitle === undefined ? [] : [`  ${theme.accent(subtitle)}`]),
    "",
    `  ${theme.gradient(theme.glyphs.horizontal.repeat(Math.max(width, visibleLength(TAGLINE))))}`,
    "",
  ];

  return [...lines, ...footer].join("\n");
}
