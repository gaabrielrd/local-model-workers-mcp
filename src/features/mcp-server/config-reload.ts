import { watchFile, unwatchFile } from "node:fs";

import type { EffectiveConfiguration } from "../configuration/index.js";

export interface ConfigReloadWatchPort {
  watchFile(
    filename: string,
    options: { interval: number },
    listener: () => void,
  ): void;
  unwatchFile(filename: string): void;
}

export interface ConfigReloadClock {
  now(): number;
}

export interface ConfigurationReloadOutcome {
  readonly applied: boolean;
  readonly revision: string;
  readonly checked_at_ms: number;
  readonly error?: string;
}

export interface ConfigurationReloaderOptions {
  readonly watchPath: string;
  readonly resolveConfiguration: () => Promise<EffectiveConfiguration>;
  readonly watch?: ConfigReloadWatchPort;
  readonly clock?: ConfigReloadClock;
  readonly watch_interval_ms?: number;
  readonly initialRevision?: string;
  readonly writeDiagnostic?: (message: string) => void;
  readonly onApplied?: (configuration: EffectiveConfiguration) => void;
}

export interface ConfigurationReloader {
  start(): void;
  stop(): void;
  reload(): Promise<ConfigurationReloadOutcome>;
  status(): {
    readonly watching: boolean;
    readonly last_outcome?: ConfigurationReloadOutcome;
  };
}

const nodeConfigReloadWatch: ConfigReloadWatchPort = {
  watchFile: (filename, options, listener) => {
    watchFile(filename, { interval: options.interval }, (curr, prev) => {
      if (
        curr.mtimeMs === prev.mtimeMs &&
        curr.size === prev.size &&
        curr.ino === prev.ino
      ) {
        return;
      }
      listener();
    });
  },
  unwatchFile,
};

const nodeConfigReloadClock: ConfigReloadClock = {
  now: () => Date.now(),
};

export function createConfigurationReloader(
  options: ConfigurationReloaderOptions,
): ConfigurationReloader {
  const watch = options.watch ?? nodeConfigReloadWatch;
  const clock = options.clock ?? nodeConfigReloadClock;
  const intervalMs = options.watch_interval_ms ?? 1_000;
  let watching = false;
  let lastOutcome: ConfigurationReloadOutcome | undefined;
  let appliedRevision = options.initialRevision ?? "none";
  let inFlight: Promise<ConfigurationReloadOutcome> | undefined;

  function reload(): Promise<ConfigurationReloadOutcome> {
    inFlight ??= runReload().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function runReload(): Promise<ConfigurationReloadOutcome> {
    const checkedAtMs = clock.now();
    try {
      const configuration = await options.resolveConfiguration();
      appliedRevision = configuration.revision;
      options.onApplied?.(configuration);
      const outcome: ConfigurationReloadOutcome = {
        applied: true,
        revision: configuration.revision,
        checked_at_ms: checkedAtMs,
      };
      lastOutcome = outcome;
      options.writeDiagnostic?.(
        `[config] Configuration reloaded (${configuration.revision}).\n`,
      );
      return outcome;
    } catch (error: unknown) {
      const outcome: ConfigurationReloadOutcome = {
        applied: false,
        revision: appliedRevision,
        checked_at_ms: checkedAtMs,
        error: errorMessage(error),
      };
      lastOutcome = outcome;
      options.writeDiagnostic?.(
        "[config] Configuration reload rejected; keeping previous configuration.\n",
      );
      return outcome;
    }
  }

  function start(): void {
    if (watching) return;
    watching = true;
    watch.watchFile(options.watchPath, { interval: intervalMs }, () => {
      void reload();
    });
  }

  function stop(): void {
    if (!watching) return;
    watching = false;
    watch.unwatchFile(options.watchPath);
  }

  return Object.freeze({
    start,
    stop,
    reload,
    status: () =>
      Object.freeze({
        watching,
        ...(lastOutcome === undefined ? {} : { last_outcome: lastOutcome }),
      }),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
