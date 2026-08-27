export {
  AgentTeamScenarioSchema,
  parseAgentTeamScenario,
  loadAgentTeamScenario,
  aggregateAgentTeamEvents,
  evaluateAgentTeamExpectations,
  runAgentTeam,
  loadAgentTeamResult,
  compareAgentTeamResults,
  formatAgentTeamRun,
  formatAgentTeamComparison,
} from './agent-team.js';
export type {
  AgentTeamScenario,
  AgentTeamEvent,
  AgentTeamEventKind,
  AgentTeamMember,
  AgentTeamMetrics,
  AgentTeamRunResult,
  AgentTeamComparisonResult,
  RunAgentTeamOptions,
} from './agent-team.js';

export {
  runDoctor,
  runDoctorReport,
  formatDoctor,
  detectProviderConfiguration,
  findExecutable,
} from './doctor.js';
export type {
  DoctorOptions,
  DoctorReport,
  DoctorWarning,
  DoctorProviderMode,
  DoctorProviderReport,
  DoctorPluginReport,
  DoctorMcpReport,
  DoctorMcpServerReport,
  DoctorMcpTransport,
  DoctorBinaryRequirement,
  DoctorBinaryKind,
} from './doctor.js';

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
export { proposeBaselineUpdate, applyBaselineProposal } from './baseline-review.js';
export type { BaselineProposal } from './baseline-review.js';
export type { RunResult, RunMetrics, PermissionRequestTrace, PermissionPolicyCoverage, CommandSummary, ProcessResult } from './types.js';

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

// v1.3: suites, release watch, stability, failure families, selective execution and safe result reuse.
export {
  SuiteSchema,
  parseSuite,
  loadSuite,
  resolveSuiteScenarios,
  explainSuiteSelection,
  runSuite,
  combineSuiteResults,
  formatSuiteMarkdown,
} from './suite.js';
export type {
  ScenarioSuite,
  ScenarioSuiteEntry,
  ResolvedSuiteScenario,
  SkippedSuiteScenario,
  SuiteSelection,
  SuiteRunOptions,
  SuiteScenarioResult,
  SuiteRunResult,
} from './suite.js';
export { fingerprintRun, clusterRunFailures, classifyRunFailure } from './fingerprint.js';
export type { FailureFingerprint } from './fingerprint.js';
export { analyzeFlakiness, summarizeFlakeRuns, formatFlakeMarkdown } from './flake.js';
export type { FlakeOptions, FlakeMetricStats, FlakeResult, StabilityClassification } from './flake.js';
export { analyzeSuiteFlakiness, summarizeSuiteFlakiness, formatSuiteFlakeMarkdown } from './suite-flake.js';
export type { SuiteFlakeResult } from './suite-flake.js';
export { watchClaudeCodeReleases, readWatchState, formatWatchMarkdown } from './watch.js';
export type { WatchOptions, WatchResult, WatchState, WatchStatus } from './watch.js';
export {
  buildResultCacheIdentity,
  resultCacheKey,
  readCachedRun,
  writeCachedRun,
  runScenarioWithCache,
} from './result-cache.js';
export type { ResultCacheIdentity, CachedRunEnvelope } from './result-cache.js';

// v1.4: interoperable reports and explicit baseline review.
export { suiteToJUnit } from './junit.js';
export { suiteToSarif } from './sarif.js';
export type { SarifLog } from './sarif.js';
export { loadResultSummaries, renderStaticHtmlReport, generateStaticHtmlReport } from './report-html.js';
export type { ResultArtifactSummary } from './report-html.js';
export { loadTrendPoints, summarizeTrends, formatTrendMarkdown } from './trend.js';
export type { TrendPoint, TrendSummary } from './trend.js';

// v1.5/v2: portable compatibility evidence, lockfiles, registries, graph/query API and scenario packs.
export {
  CompatibilityManifestSchema,
  CanaryLockSchema,
  CompatibilityRegistrySchema,
  sha256Canonical,
  createCompatibilityManifest,
  writeCompatibilityManifest,
  loadCompatibilityManifest,
  loadCompatibilityRegistry,
  writeCompatibilityRegistry,
  createCanaryLock,
  writeCanaryLock,
  loadCanaryLock,
  checkCanaryLock,
  mergeCompatibilityRegistries,
  aggregateRegistryFiles,
  queryCompatibility,
  compareVersion,
  newestKnownGood,
  firstKnownBad,
  explainCompatibility,
  buildCompatibilityGraph,
  compatibilityBadgeMarkdown,
} from './compatibility.js';
export type {
  CompatibilityManifest,
  CanaryLock,
  CompatibilityRegistry,
  CompatibilityQuery,
  CompatibilityExplanation,
  CompatibilityGraph,
} from './compatibility.js';
export { ScenarioPackSchema, inspectScenarioPack, installScenarioPack } from './packs.js';
export type { ScenarioPack, InspectedScenarioPack } from './packs.js';

// v1.6: policy/trust, gateway matrices, isolated MCP fixtures and attestation.
export { PermissionPolicySchema, evaluatePermissionPolicy } from './policy.js';
export type { PermissionPolicy, PermissionPolicyEvaluation } from './policy.js';
export { LifecycleTrustPolicySchema, evaluateLifecycleTrust, compareTrustSurfaces } from './trust.js';
export type { LifecycleTrustPolicy, LifecycleTrustResult, TrustSurfaceDiff } from './trust.js';
export { GatewayMatrixSchema, loadGatewayMatrix, runGatewayMatrix } from './gateway.js';
export type { GatewayMatrix, GatewayMatrixResult } from './gateway.js';
export { createSafeMcpFixture } from './mcp-fixtures.js';
export type { SafeMcpFixture, SafeMcpFixtureKind } from './mcp-fixtures.js';
export { createBundleAttestation, verifyBundleAttestation } from './attestation.js';
export type { BundleAttestation, BundleAttestationFile } from './attestation.js';
export { CanaryExitCode, exitCodeForSuite, exitCodeForWatch } from './exit-codes.js';

export { CANARY_VERSION } from './version.js';
