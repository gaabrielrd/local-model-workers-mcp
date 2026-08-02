export const TOOL_NAMES = Object.freeze({
  autoValidateTests: "auto_validate_tests",
  checkHealth: "check_health",
  exploreRepository: "explore_repository",
  fixLintViolations: "fix_lint_violations",
  generateDocsPatch: "generate_docs_patch",
  getConfig: "get_config",
  proposeTests: "propose_tests",
  queryCodeGraph: "query_code_graph",
  searchSemantic: "search_semantic",
  summarizeModule: "summarize_module",
  updateConfig: "update_config",
  validateConfig: "validate_config",
} as const);

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export const TASK_TOOL_NAMES = Object.freeze([
  TOOL_NAMES.autoValidateTests,
  TOOL_NAMES.exploreRepository,
  TOOL_NAMES.proposeTests,
  TOOL_NAMES.queryCodeGraph,
  TOOL_NAMES.searchSemantic,
  TOOL_NAMES.summarizeModule,
] as const);

export type TaskToolName = (typeof TASK_TOOL_NAMES)[number];

export const NON_TASK_TOOL_NAMES = Object.freeze([
  TOOL_NAMES.checkHealth,
  TOOL_NAMES.fixLintViolations,
  TOOL_NAMES.generateDocsPatch,
  TOOL_NAMES.getConfig,
  TOOL_NAMES.validateConfig,
  TOOL_NAMES.updateConfig,
] as const);

export type NonTaskToolName = (typeof NON_TASK_TOOL_NAMES)[number];
