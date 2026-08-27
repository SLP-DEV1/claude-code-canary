export { ScenarioSchema, loadScenario, parseScenario } from './config.js';
export type { Scenario } from './config.js';

export { runScenario, filterFixtureChanges } from './runner.js';
export type { PreparedRun, RunOptions } from './runner.js';
export { formatRun, formatComparison } from './report.js';
export { formatComparisonMarkdown } from './comparison-markdown.js';
export type { ComparisonReportSubject, ComparisonMarkdownOptions } from './comparison-markdown.js';
export { evaluateComparisonRegressions } from './regressions.js';
export type { ComparisonRegressionResult, RegressionComparable } from './regressions.js';
export { runPrCheck } from './pr-check.js';
export type { PrCheckOptions, PrCheckResult } from './pr-check.js';
export { updateBaseline, checkBaseline, loadBaseline, defaultBaselinePath } from './baseline.js';
export type { BaselineSnapshot, BaselineUpdateOptions, BaselineUpdateResult, BaselineCheckOptions, BaselineCheckResult } from './baseline.js';
export type { RunResult, RunMetrics, PermissionRequestTrace, CommandSummary, ProcessResult } from './types.js';

export { bisectCommands, bisectReleases } from './bisect.js';
export { runExperiment, formatExperiment } from './experiment.js';

export { discoverPlugin, generatePluginScenarios } from './plugin-init.js';
export type { PluginComponent, PluginComponentKind, PluginDiscovery, PluginInitOptions, PluginInitResult, GeneratedPluginScenario } from './plugin-init.js';
export { discoverExtendedPluginSurfaces } from './plugin-surfaces.js';
export type { PluginDependency, PluginExtendedSurfaces, PluginLspServer, PluginMonitor, PluginSurfaceSource } from './plugin-surfaces.js';
export {
  runPluginMatrix,
  resolvePluginMatrixVersions,
  formatPluginMatrixMarkdown,
  validateExplicitVersions,
  selectRecentPublishedVersions,
} from './plugin-matrix.js';
export type {
  PluginMatrixEntry,
  PluginMatrixResult,
  RunPluginMatrixOptions,
} from './plugin-matrix.js';

export {
  runPluginSuite,
  formatPluginSuiteMarkdown,
  loadGeneratedPluginSuite,
  validatePluginSuiteRunBudget,
} from './plugin-suite.js';
export type {
  PluginSuiteResult,
  PluginSuiteScenario,
  PluginSuiteScenarioResult,
  PluginSuiteVersionResult,
  RunPluginSuiteOptions,
} from './plugin-suite.js';

export {
  McpContractSchema,
  loadMcpContract,
  inspectMcpContract,
  evaluateMcpExpectations,
  compareMcpSnapshots,
  writeMcpSnapshot,
  loadMcpSnapshot,
  checkMcpContract,
  compareMcpContracts,
  defaultMcpSnapshotPath,
  formatMcpCheckMarkdown,
  formatMcpComparisonMarkdown,
} from './mcp-contract.js';
export type {
  McpContract,
  McpContractSnapshot,
  McpToolSnapshot,
  McpPromptSnapshot,
  McpResourceSnapshot,
  McpResourceTemplateSnapshot,
  McpExpectationResult,
  McpComparisonResult,
  McpCheckResult,
  McpSnapshotOptions,
  McpCheckOptions,
  McpCompareOptions,
} from './mcp-contract.js';

export { createReproBundle } from './repro.js';
export {
  cachedClaudePath,
  installClaudeVersion,
  listCachedClaudeVersions,
  platformId,
  resolveClaudeVersion,
  validatePlatformId,
} from './versions.js';
export type { InstalledClaudeVersion, InstallVersionOptions } from './versions.js';

export { CANARY_VERSION } from './version.js';
