export { ScenarioSchema, loadScenario, parseScenario } from './config.js';
export type { Scenario } from './config.js';

export { runScenario, filterFixtureChanges } from './runner.js';
export type { PreparedRun, RunOptions } from './runner.js';
export { formatRun, formatComparison } from './report.js';
export type { RunResult, RunMetrics, CommandSummary, ProcessResult } from './types.js';

export { bisectCommands, bisectReleases } from './bisect.js';
export { runExperiment, formatExperiment } from './experiment.js';

export { discoverPlugin, generatePluginScenarios } from './plugin-init.js';
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
