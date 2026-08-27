import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRepoRoot, getTrackedChanges } from './git.js';
import { discoverPlugin, type PluginDiscovery } from './plugin-init.js';
import { spawnCapture } from './process.js';
import type { DoctorCheck } from './types.js';
import { CANARY_VERSION } from './version.js';

const MAX_MCP_CONFIG_BYTES = 1024 * 1024;

export type DoctorProviderMode = 'first-party' | 'custom-base-url' | 'bedrock' | 'vertex' | 'foundry' | 'mantle' | 'ambiguous';
export type DoctorMcpTransport = 'stdio' | 'http' | 'sse' | 'unknown';
export type DoctorBinaryKind = 'lsp' | 'mcp';

export interface DoctorWarning {
  code: string;
  message: string;
}

export interface DoctorProviderReport {
  mode: DoctorProviderMode;
  indicators: string[];
  credentialsPresent: {
    anthropicApiKey: boolean;
    claudeOauthToken: boolean;
    awsRegion: boolean;
    awsCredentials: boolean;
    vertexProject: boolean;
    googleCredentials: boolean;
    foundryResource: boolean;
  };
}

export interface DoctorBinaryRequirement {
  kind: DoctorBinaryKind;
  owner: string;
  name: string;
  executable: string;
  available: boolean;
}

export interface DoctorPluginReport {
  path: string;
  ok: boolean;
  name?: string;
  componentTypes: string[];
  counts: {
    commands: number;
    agents: number;
    skills: number;
    hooks: number;
    mcpServers: number;
    lspServers: number;
    monitors: number;
    dependencies: number;
  };
  dependencies: Array<{ name: string; version?: string; marketplace?: string }>;
  warnings: string[];
  error?: string;
}

export interface DoctorMcpServerReport {
  name: string;
  transport: DoctorMcpTransport;
  executable?: string;
  executableAvailable?: boolean;
}

export interface DoctorMcpReport {
  projectConfig: boolean;
  servers: DoctorMcpServerReport[];
  transports: Record<DoctorMcpTransport, number>;
  warnings: string[];
}

export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  canaryVersion: string;
  runtime: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    tty: boolean;
    ci: boolean;
  };
  claude: {
    requestedExecutable: string;
    executableSource: 'PATH' | 'explicit-path' | 'unresolved';
    available: boolean;
    version?: string;
  };
  repository: {
    available: boolean;
    clean?: boolean;
    trackedChanges?: number;
  };
  provider: DoctorProviderReport;
  features: {
    agentTeams: boolean;
  };
  plugins: DoctorPluginReport[];
  mcp: DoctorMcpReport;
  requiredBinaries: DoctorBinaryRequirement[];
  checks: DoctorCheck[];
  warnings: DoctorWarning[];
}

export interface DoctorOptions {
  claudeExecutable?: string;
  plugins?: string[];
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  autoDiscoverPlugin?: boolean;
  inspectMcp?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function envPresent(env: NodeJS.ProcessEnv, name: string): boolean {
  return typeof env[name] === 'string' && env[name]!.length > 0;
}

export function detectProviderConfiguration(env: NodeJS.ProcessEnv = process.env): DoctorProviderReport {
  const flags = [
    ['CLAUDE_CODE_USE_BEDROCK', 'bedrock'],
    ['CLAUDE_CODE_USE_VERTEX', 'vertex'],
    ['CLAUDE_CODE_USE_FOUNDRY', 'foundry'],
    ['CLAUDE_CODE_USE_MANTLE', 'mantle'],
  ] as const;
  const active = flags.filter(([name]) => envPresent(env, name));
  const customBaseUrl = envPresent(env, 'ANTHROPIC_BASE_URL');
  const indicators = active.map(([name]) => name);
  if (customBaseUrl) indicators.push('ANTHROPIC_BASE_URL');

  let mode: DoctorProviderMode;
  if (active.length > 1) mode = 'ambiguous';
  else if (active.length === 1) mode = active[0][1];
  else if (customBaseUrl) mode = 'custom-base-url';
  else mode = 'first-party';

  return {
    mode,
    indicators,
    credentialsPresent: {
      anthropicApiKey: envPresent(env, 'ANTHROPIC_API_KEY'),
      claudeOauthToken: envPresent(env, 'CLAUDE_CODE_OAUTH_TOKEN'),
      awsRegion: envPresent(env, 'AWS_REGION') || envPresent(env, 'AWS_DEFAULT_REGION'),
      awsCredentials: envPresent(env, 'AWS_ACCESS_KEY_ID') || envPresent(env, 'AWS_PROFILE') || envPresent(env, 'AWS_BEARER_TOKEN_BEDROCK'),
      vertexProject: envPresent(env, 'ANTHROPIC_VERTEX_PROJECT_ID') || envPresent(env, 'GOOGLE_CLOUD_PROJECT'),
      googleCredentials: envPresent(env, 'GOOGLE_APPLICATION_CREDENTIALS'),
      foundryResource: envPresent(env, 'ANTHROPIC_FOUNDRY_RESOURCE'),
    },
  };
}

function candidateExecutableNames(command: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return [command];
  if (path.extname(command)) return [command];
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`), ...extensions.map((extension) => `${command}${extension.toUpperCase()}`)];
}

export async function findExecutable(command: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const explicit = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  if (explicit) {
    const resolved = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    for (const candidate of candidateExecutableNames(resolved, env)) {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue searching extensions on Windows.
      }
    }
    return null;
  }

  for (const directory of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of candidateExecutableNames(command, env)) {
      const candidate = path.join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null;
}

function executableLabel(command: string): string {
  return path.basename(command.replace(/\\/g, '/')) || command;
}

function displayPath(target: string, base: string): string {
  const relative = path.relative(base, target).split(path.sep).join('/');
  if (!relative) return '.';
  if (!relative.startsWith('../') && relative !== '..') return relative;
  return path.basename(target);
}

function componentTypes(discovery: PluginDiscovery): string[] {
  const values: Array<[string, number]> = [
    ['commands', discovery.commands.length],
    ['agents', discovery.agents.length],
    ['skills', discovery.skills.length],
    ['hooks', discovery.hooks.length],
    ['mcp', discovery.mcpServers.length],
    ['lsp', discovery.lspServers.length],
    ['monitors', discovery.monitors.length],
    ['dependencies', discovery.dependencies.length],
  ];
  return values.filter(([, count]) => count > 0).map(([name]) => name);
}

async function inspectPlugin(
  pluginPath: string,
  base: string,
  env: NodeJS.ProcessEnv,
  binaries: DoctorBinaryRequirement[],
  checks: DoctorCheck[],
): Promise<DoctorPluginReport> {
  const resolved = path.resolve(pluginPath);
  const shown = displayPath(resolved, base);
  try {
    const discovery = await discoverPlugin(resolved);
    checks.push({ name: `Plugin ${discovery.pluginName}`, ok: true, detail: `${componentTypes(discovery).join(', ') || 'no components'} (${shown})` });
    for (const lsp of discovery.lspServers) {
      const available = await findExecutable(lsp.command, discovery.pluginRoot, env) !== null;
      const requirement: DoctorBinaryRequirement = {
        kind: 'lsp',
        owner: discovery.pluginName,
        name: lsp.name,
        executable: executableLabel(lsp.command),
        available,
      };
      binaries.push(requirement);
      checks.push({
        name: `LSP binary ${discovery.pluginName}/${lsp.name}`,
        ok: available,
        detail: available ? `${requirement.executable} available` : `${requirement.executable} not found`,
      });
    }
    return {
      path: shown,
      ok: true,
      name: discovery.pluginName,
      componentTypes: componentTypes(discovery),
      counts: {
        commands: discovery.commands.length,
        agents: discovery.agents.length,
        skills: discovery.skills.length,
        hooks: discovery.hooks.length,
        mcpServers: discovery.mcpServers.length,
        lspServers: discovery.lspServers.length,
        monitors: discovery.monitors.length,
        dependencies: discovery.dependencies.length,
      },
      dependencies: discovery.dependencies,
      warnings: discovery.warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: `Plugin ${shown}`, ok: false, detail: message });
    return {
      path: shown,
      ok: false,
      componentTypes: [],
      counts: { commands: 0, agents: 0, skills: 0, hooks: 0, mcpServers: 0, lspServers: 0, monitors: 0, dependencies: 0 },
      dependencies: [],
      warnings: [],
      error: message,
    };
  }
}

function classifyMcpTransport(raw: Record<string, unknown>): DoctorMcpTransport {
  if (raw.type === 'stdio' || (raw.type === undefined && typeof raw.command === 'string')) return 'stdio';
  if (raw.type === 'sse') return 'sse';
  if (raw.type === 'http' || raw.type === 'streamable-http' || (raw.type === undefined && typeof raw.url === 'string')) return 'http';
  return 'unknown';
}

async function inspectProjectMcp(
  root: string,
  env: NodeJS.ProcessEnv,
  binaries: DoctorBinaryRequirement[],
  checks: DoctorCheck[],
): Promise<DoctorMcpReport> {
  const result: DoctorMcpReport = {
    projectConfig: false,
    servers: [],
    transports: { stdio: 0, http: 0, sse: 0, unknown: 0 },
    warnings: [],
  };
  const file = path.join(root, '.mcp.json');
  if (!await exists(file)) return result;
  result.projectConfig = true;

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_MCP_CONFIG_BYTES) throw new Error(`.mcp.json exceeds ${MAX_MCP_CONFIG_BYTES} bytes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: 'Project MCP config', ok: false, detail: message });
    result.warnings.push(message);
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = `Invalid .mcp.json: ${error instanceof Error ? error.message : String(error)}`;
    checks.push({ name: 'Project MCP config', ok: false, detail: message });
    result.warnings.push(message);
    return result;
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    const message = '.mcp.json must contain an mcpServers object.';
    checks.push({ name: 'Project MCP config', ok: false, detail: message });
    result.warnings.push(message);
    return result;
  }

  checks.push({ name: 'Project MCP config', ok: true, detail: `${Object.keys(parsed.mcpServers).length} server(s)` });
  for (const [name, value] of Object.entries(parsed.mcpServers).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isRecord(value)) {
      result.transports.unknown += 1;
      result.servers.push({ name, transport: 'unknown' });
      result.warnings.push(`MCP server ${name} is not an object.`);
      continue;
    }
    const transport = classifyMcpTransport(value);
    result.transports[transport] += 1;
    const server: DoctorMcpServerReport = { name, transport };
    if (transport === 'stdio') {
      if (typeof value.command !== 'string' || !value.command.trim()) {
        server.executableAvailable = false;
        result.warnings.push(`MCP server ${name} has no command.`);
        checks.push({ name: `MCP binary ${name}`, ok: false, detail: 'missing command' });
      } else {
        server.executable = executableLabel(value.command);
        server.executableAvailable = await findExecutable(value.command, root, env) !== null;
        binaries.push({ kind: 'mcp', owner: 'project', name, executable: server.executable, available: server.executableAvailable });
        checks.push({
          name: `MCP binary ${name}`,
          ok: server.executableAvailable,
          detail: server.executableAvailable ? `${server.executable} available` : `${server.executable} not found`,
        });
      }
    } else if (transport === 'unknown') {
      result.warnings.push(`MCP server ${name} uses an unrecognized transport declaration.`);
    }
    result.servers.push(server);
  }
  return result;
}

function addProviderWarnings(provider: DoctorProviderReport, env: NodeJS.ProcessEnv, warnings: DoctorWarning[]): void {
  if (provider.mode === 'ambiguous') {
    warnings.push({
      code: 'provider.multiple-flags',
      message: 'Multiple Claude Code cloud-provider flags are set. Keep only the provider mode you intend to use.',
    });
  }
  const providerFlags = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE'];
  for (const name of providerFlags) {
    if (!envPresent(env, name)) continue;
    const value = env[name]!.toLowerCase();
    if (value !== '1' && value !== 'true') {
      warnings.push({
        code: 'provider.truthy-flag',
        message: `${name} is set. Claude Code provider flags are presence-sensitive; remove the variable rather than setting a false-like value when disabling it.`,
      });
    }
  }
}

function agentTeamsEnabled(env: NodeJS.ProcessEnv): boolean {
  return envPresent(env, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');
}

export async function runDoctorReport(cwd: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const claudeExecutable = options.claudeExecutable ?? 'claude';
  const tty = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const checks: DoctorCheck[] = [];
  const warnings: DoctorWarning[] = [];
  const requiredBinaries: DoctorBinaryRequirement[] = [];
  const provider = detectProviderConfiguration(env);
  addProviderWarnings(provider, env, warnings);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'Node.js', ok: nodeMajor >= 20, detail: process.version });

  const git = await spawnCapture('git', ['--version'], { cwd, timeoutMs: 10_000, env });
  checks.push({ name: 'Git', ok: git.code === 0, detail: git.code === 0 ? git.stdout.trim() : 'not available' });

  const resolvedClaude = await findExecutable(claudeExecutable, cwd, env);
  const claude = await spawnCapture(claudeExecutable, ['--version'], { cwd, timeoutMs: 15_000, env });
  const claudeAvailable = claude.code === 0;
  const claudeVersion = claudeAvailable ? (claude.stdout || claude.stderr).trim() : undefined;
  checks.push({ name: 'Claude Code', ok: claudeAvailable, detail: claudeAvailable ? claudeVersion! : `${claudeExecutable} not available` });

  let repoRoot: string | undefined;
  let repositoryClean: boolean | undefined;
  let trackedChanges: number | undefined;
  try {
    repoRoot = await getRepoRoot(cwd);
    checks.push({ name: 'Git repository', ok: true, detail: repoRoot });
    const changes = await getTrackedChanges(repoRoot);
    trackedChanges = changes.length;
    repositoryClean = changes.length === 0;
    checks.push({
      name: 'Tracked tree clean',
      ok: repositoryClean,
      detail: repositoryClean ? 'clean' : `${changes.length} tracked change(s); commit or stash before running`,
    });
  } catch (error) {
    checks.push({ name: 'Git repository', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  const base = repoRoot ?? path.resolve(cwd);
  let pluginPaths = [...new Set((options.plugins ?? []).map((value) => path.resolve(cwd, value)))];
  if (options.autoDiscoverPlugin !== false && pluginPaths.length === 0 && await exists(path.join(cwd, '.claude-plugin', 'plugin.json'))) {
    pluginPaths = [path.resolve(cwd)];
  }
  const plugins: DoctorPluginReport[] = [];
  for (const pluginPath of pluginPaths) plugins.push(await inspectPlugin(pluginPath, base, env, requiredBinaries, checks));

  const mcp = options.inspectMcp === false
    ? { projectConfig: false, servers: [], transports: { stdio: 0, http: 0, sse: 0, unknown: 0 }, warnings: [] } satisfies DoctorMcpReport
    : await inspectProjectMcp(repoRoot ?? path.resolve(cwd), env, requiredBinaries, checks);

  const teams = agentTeamsEnabled(env);
  if (teams && !tty) {
    warnings.push({
      code: 'agent-teams.no-tty',
      message: 'Agent teams are enabled, but this process has no interactive TTY. Canary team-run requires a real TTY and will report unsupported here.',
    });
  }
  if (teams && provider.mode !== 'first-party') {
    warnings.push({
      code: 'agent-teams.provider-variance',
      message: `Agent-team availability may differ with provider mode ${provider.mode}; verify the feature in an interactive Claude Code session before treating it as supported.`,
    });
  }
  for (const plugin of plugins) {
    for (const warning of plugin.warnings) warnings.push({ code: 'plugin.warning', message: `${plugin.name ?? plugin.path}: ${warning}` });
  }
  for (const warning of mcp.warnings) warnings.push({ code: 'mcp.warning', message: warning });

  if (provider.mode === 'ambiguous') checks.push({ name: 'Provider configuration', ok: false, detail: 'multiple provider flags set' });
  else checks.push({ name: 'Provider configuration', ok: true, detail: provider.mode });

  const report: DoctorReport = {
    schemaVersion: 1,
    ok: checks.every((check) => check.ok),
    canaryVersion: CANARY_VERSION,
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      tty,
      ci: envPresent(env, 'CI'),
    },
    claude: {
      requestedExecutable: executableLabel(claudeExecutable),
      executableSource: resolvedClaude === null ? 'unresolved' : (path.isAbsolute(claudeExecutable) || claudeExecutable.includes('/') || claudeExecutable.includes('\\') ? 'explicit-path' : 'PATH'),
      available: claudeAvailable,
      version: claudeVersion,
    },
    repository: {
      available: repoRoot !== undefined,
      clean: repositoryClean,
      trackedChanges,
    },
    provider,
    features: { agentTeams: teams },
    plugins,
    mcp,
    requiredBinaries,
    checks,
    warnings,
  };
  return report;
}

export async function runDoctor(cwd: string, claudeExecutable = 'claude'): Promise<DoctorCheck[]> {
  const report = await runDoctorReport(cwd, {
    claudeExecutable,
    plugins: [],
    autoDiscoverPlugin: false,
    inspectMcp: false,
  });
  return report.checks;
}

export function formatDoctor(input: DoctorCheck[] | DoctorReport): string {
  const report = Array.isArray(input) ? undefined : input;
  const checks = Array.isArray(input) ? input : input.checks;
  const lines = ['Claude Code Canary — doctor', ''];
  for (const check of checks) lines.push(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  if (!report) return lines.join('\n');

  lines.push('', 'Compatibility');
  lines.push(`  Provider: ${report.provider.mode}`);
  lines.push(`  Platform: ${report.runtime.platform}-${report.runtime.arch}`);
  lines.push(`  Agent teams: ${report.features.agentTeams ? 'enabled' : 'disabled'}${report.runtime.tty ? ' (TTY)' : ' (no TTY)'}`);
  lines.push(`  Project MCP: ${report.mcp.projectConfig ? `${report.mcp.servers.length} server(s)` : 'none'}`);
  if (report.plugins.length === 0) lines.push('  Plugins: none inspected');
  for (const plugin of report.plugins) {
    lines.push(`  Plugin ${plugin.name ?? plugin.path}: ${plugin.ok ? plugin.componentTypes.join(', ') || 'no components' : plugin.error}`);
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings');
    for (const warning of report.warnings) lines.push(`  ! ${warning.message}`);
  }
  return lines.join('\n');
}
