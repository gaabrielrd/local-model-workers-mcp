export {
  applyGlobalPreferences,
  proposeGlobalPreferences,
  type GlobalPreferencesProposal,
  type ProposeGlobalPreferencesInput,
} from "./global-preferences.js";
export {
  applyHarnessConfiguration,
  proposeHarnessConfigurations,
  type ApplyHarnessConfigurationInput,
  type Harness,
  type HarnessConfigurationProposal,
  type HarnessConfigurationResult,
  type HarnessConfirmation,
  type HarnessSelection,
  type HarnessSteeringPlan,
  type InstallationState,
  type ProposeHarnessConfigurationsInput,
} from "./harnesses.js";
export {
  HarnessSteeringConfigSchema,
  STEERING_MARKER_END,
  STEERING_MARKER_START,
  buildSteeringInstructions,
  type HarnessSteeringConfig,
  type SteeringInstructions,
} from "./steering.js";
export {
  describeJetBrainsVersionWarnings,
  detectJetBrainsIdeVersions,
  resolveJetBrainsConfigRoot,
  resolveJetBrainsMcpConfigPath,
  resolveJetBrainsRulesPath,
  type DetectJetBrainsIdeVersionsInput,
  type JetBrainsDirectoryReader,
  type JetBrainsIdeInstallation,
  type JetBrainsVersion,
  JETBRAINS_MIN_MCP_VERSION,
} from "./jetbrains.js";
export {
  isInstallationCommand,
  runInstallationCommand,
  type InstallationCommandIo,
} from "./cli.js";
export { runInteractiveSetup } from "./interactive.js";
export {
  createCheckboxState,
  moveCheckboxCursor,
  selectOptions,
  selectedCheckboxValues,
  toggleCheckboxOption,
  type CheckboxState,
  type SelectableOption,
  type SelectOptionsInput,
  type SelectOptionsResult,
} from "./select-options.js";
export {
  ACCENT_END,
  ACCENT_START,
  createTheme,
  detectCapabilities,
  startSpinner,
  stripAnsi,
  visibleLength,
  type ColorDepth,
  type DetectCapabilitiesInput,
  type Rgb,
  type SpinnerHandle,
  type StartSpinnerInput,
  type Theme,
  type ThemeCapabilities,
} from "./theme.js";
export { renderBanner, type BannerInput } from "./banner.js";
