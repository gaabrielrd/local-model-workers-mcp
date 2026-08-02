export const TOOL_NAMES = Object.freeze({
  checkHealth: "check_health",
  exploreRepository: "explore_repository",
  getConfig: "get_config",
  proposeTests: "propose_tests",
  queryCodeGraph: "query_code_graph",
  searchSemantic: "search_semantic",
  updateConfig: "update_config",
  validateConfig: "validate_config",
} as const);

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export const TASK_TOOL_NAMES = Object.freeze([
  TOOL_NAMES.exploreRepository,
  TOOL_NAMES.proposeTests,
  TOOL_NAMES.queryCodeGraph,
  TOOL_NAMES.searchSemantic,
] as const);

export type TaskToolName = (typeof TASK_TOOL_NAMES)[number];

export const NON_TASK_TOOL_NAMES = Object.freeze([
  TOOL_NAMES.checkHealth,
  TOOL_NAMES.getConfig,
  TOOL_NAMES.validateConfig,
  TOOL_NAMES.updateConfig,
] as const);

export type NonTaskToolName = (typeof NON_TASK_TOOL_NAMES)[number];
