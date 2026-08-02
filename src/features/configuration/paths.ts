import path from "node:path";

import {
  CONFIGURATION_DIRECTORY_NAME,
  GLOBAL_PREFERENCES_FILENAME,
  PROJECT_PREFERENCES_FILENAME,
} from "./constants.js";

export interface ConfigurationPathInput {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export function resolveGlobalPreferencesPath(
  input: ConfigurationPathInput,
): string {
  if (input.platform === "win32") {
    const appData = nonEmpty(input.environment.APPDATA);
    const base =
      appData ?? path.win32.join(input.homeDirectory, "AppData", "Roaming");
    return path.win32.join(
      base,
      CONFIGURATION_DIRECTORY_NAME,
      GLOBAL_PREFERENCES_FILENAME,
    );
  }

  if (input.platform === "darwin") {
    return path.join(
      input.homeDirectory,
      "Library",
      "Application Support",
      CONFIGURATION_DIRECTORY_NAME,
      GLOBAL_PREFERENCES_FILENAME,
    );
  }

  const xdgConfigHome = nonEmpty(input.environment.XDG_CONFIG_HOME);
  const base = xdgConfigHome ?? path.join(input.homeDirectory, ".config");
  return path.join(
    base,
    CONFIGURATION_DIRECTORY_NAME,
    GLOBAL_PREFERENCES_FILENAME,
  );
}

export function resolveProjectPreferencesPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_PREFERENCES_FILENAME);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
