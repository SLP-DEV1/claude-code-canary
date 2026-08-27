import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { createDetachedWorktree, getRepoRoot, resolveCommit } from './git.js';
import { installClaudeVersion } from './versions.js';
import { CANARY_VERSION } from './version.js';

const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 5000;

const teamExpectations = z.object({
  expected_teammates: z.array(z.string().min(1)).default([]),
  deny_unexpected_teammates: z.boolean().default(false),
  deny_duplicate_spawns: z.boolean().default(true),
  min_teammates: z.number().int().nonnegative().optional(),
  max_teammates: z.number().int().nonnegative().optional(),
  min_tasks_created: z.number().int().nonnegative().optional(),
  min_tasks_completed: z.number().int().nonnegative().optional(),
  min_messages_sent: z.number().int().nonnegative().optional(),
  require_all_tasks_completed: z.boolean().default(false),
  require_all_teammates_idle: z.boolean().default(false),
  max_stop_failures: z.number().int().nonnegative().optional(),
}).strict();

export const AgentTeamScenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  claude: z.object({
    executable: z.string().min(1).default('claude'),
    args: z.array(z.string()).default([]),
    model: z.string().min(1).optional(),
    permission_mode: z.enum(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']).optional(),
    timeout_seconds: z.number().int().positive().default(1800),
    env: z.record(z.string(), z.string()).default({}),
  }).strict().default({ executable: 'claude', args: [], timeout_seconds: 1800, env: {} }),
  expect: teamExpectations.optional(),
}).strict();

export type AgentTeamScenario = z.infer<typeof AgentTeamScenarioSchema>;

export type AgentTeamEventKind =
  | 'teammate_spawned'
  | 'teammate_idle'
  | 'task_created'
  | 'task_completed'
  | 'message_sent'
  | 'stop_failure';

export interface AgentTeamEvent {
  kind: AgentTeamEventKind;
  at: string;
  teammate?: string;
  agentType?: string;
  model?: string;
  taskId?: string;
  recipient?: string;
}

export interface AgentTeamMember {
  name: string;
  agentType?: string;
  model?: string;
}

export interface AgentTeamMetrics {
  teammateCount: number;
  teammates: AgentTeamMember[];
  duplicateTeammates: string[];
  idleTeammates: string[];
  orphanedTeammates: string[];
  tasksCreated: number;
  tasksCompleted: number;
  incompleteTaskIds: string[];
  completedWithoutCreateIds: string[];
  messagesSent: number;
  stopFailures: number;
  coordinationDurationMs?: number;
}

export interface AgentTeamRunResult {
  schemaVersion: 1;
  kind: 'agent-team-run';
  canaryVersion: string;
  experimental: true;
  status: 'passed' | 'failed' | 'unsupported';
  scenario: string;
  executable: string;
  claudeVersion?: string;
  gitCommit: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  failures: string[];
  metrics: AgentTeamMetrics;
  events: AgentTeamEvent[];
  createdAt: string;
  artifactPath?: string;
}

export interface AgentTeamComparisonResult {
  schemaVersion: 1;
  kind: 'agent-team-comparison';
  passed: boolean;
  failures: string[];
  baseline: AgentTeamRunResult;
  candidate: AgentTeamRunResult;
  deltas: {
    teammateCount: number;
    tasksCreated: number;
    tasksCompleted: number;
    messagesSent: number;
    stopFailures: number;
    coordinationDurationMs?: number;
  };
}

interface InteractiveProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export interface RunAgentTeamOptions {
  cwd?: string;
  version?: string;
  platform?: string;
  executableOverride?: string;
  gitRefOverride?: string;
  onStatus?: (message: string) => void;
  isTTY?: boolean;
  interactiveRunner?: (executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<InteractiveProcessResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeSlug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  let start = 0;
  while (start < normalized.length && normalized.charCodeAt(start) === 45) start += 1;
  let end = normalized.length;
  while (end > start && normalized.charCodeAt(end - 1) === 45) end -= 1;
  return normalized.slice(start, Math.min(end, start + 80)) || 'team';
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function containsForbiddenInteractiveFlag(args: string[]): string | undefined {
  const forbidden = ['-p', '--print', '--settings', '--teammate-mode', '--output-format', '--input-format'];
  return args.find((arg) => forbidden.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

export function parseAgentTeamScenario(value: unknown): AgentTeamScenario {
  const parsed = AgentTeamScenarioSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n');
  throw new Error(`Invalid Canary agent-team scenario:\n${details}`);
}

export async function loadAgentTeamScenario(file: string): Promise<AgentTeamScenario> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read agent-team scenario ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseAgentTeamScenario(YAML.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid Canary agent-team scenario:')) throw error;
    throw new Error(`Could not parse YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function aggregateAgentTeamEvents(events: AgentTeamEvent[]): AgentTeamMetrics {
  const members = new Map<string, AgentTeamMember>();
  const spawnCounts = new Map<string, number>();
  const idle = new Set<string>();
  const created = new Set<string>();
  const completed = new Set<string>();
  let messagesSent = 0;
  let stopFailures = 0;
  let firstActivity: number | undefined;
  let lastActivity: number | undefined;

  for (const event of events) {
    const time = Date.parse(event.at);
    if (Number.isFinite(time)) {
      firstActivity = firstActivity === undefined ? time : Math.min(firstActivity, time);
      lastActivity = lastActivity === undefined ? time : Math.max(lastActivity, time);
    }
    if (event.kind === 'teammate_spawned' && event.teammate) {
      spawnCounts.set(event.teammate, (spawnCounts.get(event.teammate) ?? 0) + 1);
      const previous = members.get(event.teammate);
      members.set(event.teammate, {
        name: event.teammate,
        agentType: event.agentType ?? previous?.agentType,
        model: event.model ?? previous?.model,
      });
    } else if (event.kind === 'teammate_idle' && event.teammate) {
      idle.add(event.teammate);
      if (!members.has(event.teammate)) members.set(event.teammate, { name: event.teammate });
    } else if (event.kind === 'task_created' && event.taskId) {
      created.add(event.taskId);
    } else if (event.kind === 'task_completed' && event.taskId) {
      completed.add(event.taskId);
    } else if (event.kind === 'message_sent') {
      messagesSent += 1;
    } else if (event.kind === 'stop_failure') {
      stopFailures += 1;
    }
  }

  const teammates = [...members.values()].sort((a, b) => a.name.localeCompare(b.name));
  const duplicateTeammates = [...spawnCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort();
  const idleTeammates = [...idle].sort();
  const orphanedTeammates = teammates.map((member) => member.name).filter((name) => !idle.has(name)).sort();
  const incompleteTaskIds = [...created].filter((id) => !completed.has(id)).sort();
  const completedWithoutCreateIds = [...completed].filter((id) => !created.has(id)).sort();

  return {
    teammateCount: teammates.length,
    teammates,
    duplicateTeammates,
    idleTeammates,
    orphanedTeammates,
    tasksCreated: created.size,
    tasksCompleted: completed.size,
    incompleteTaskIds,
    completedWithoutCreateIds,
    messagesSent,
    stopFailures,
    coordinationDurationMs: firstActivity !== undefined && lastActivity !== undefined ? Math.max(0, lastActivity - firstActivity) : undefined,
  };
}

export function evaluateAgentTeamExpectations(scenario: AgentTeamScenario, metrics: AgentTeamMetrics): string[] {
  const expect = scenario.expect;
  if (!expect) return [];
  const failures: string[] = [];
  const names = new Set(metrics.teammates.map((member) => member.name));
  for (const name of expect.expected_teammates) {
    if (!names.has(name)) failures.push(`Expected teammate was not observed: ${name}`);
  }
  if (expect.deny_unexpected_teammates) {
    const expected = new Set(expect.expected_teammates);
    for (const name of [...names].sort()) if (!expected.has(name)) failures.push(`Unexpected teammate was observed: ${name}`);
  }
  if (expect.deny_duplicate_spawns && metrics.duplicateTeammates.length) {
    failures.push(`Duplicate teammate spawns observed: ${metrics.duplicateTeammates.join(', ')}`);
  }
  if (expect.min_teammates !== undefined && metrics.teammateCount < expect.min_teammates) failures.push(`Expected at least ${expect.min_teammates} teammates, observed ${metrics.teammateCount}`);
  if (expect.max_teammates !== undefined && metrics.teammateCount > expect.max_teammates) failures.push(`Expected at most ${expect.max_teammates} teammates, observed ${metrics.teammateCount}`);
  if (expect.min_tasks_created !== undefined && metrics.tasksCreated < expect.min_tasks_created) failures.push(`Expected at least ${expect.min_tasks_created} created tasks, observed ${metrics.tasksCreated}`);
  if (expect.min_tasks_completed !== undefined && metrics.tasksCompleted < expect.min_tasks_completed) failures.push(`Expected at least ${expect.min_tasks_completed} completed tasks, observed ${metrics.tasksCompleted}`);
  if (expect.min_messages_sent !== undefined && metrics.messagesSent < expect.min_messages_sent) failures.push(`Expected at least ${expect.min_messages_sent} team messages, observed ${metrics.messagesSent}`);
  if (expect.require_all_tasks_completed && metrics.incompleteTaskIds.length) failures.push(`Incomplete team tasks: ${metrics.incompleteTaskIds.join(', ')}`);
  if (expect.require_all_teammates_idle && metrics.orphanedTeammates.length) failures.push(`Teammates never observed idle before session exit: ${metrics.orphanedTeammates.join(', ')}`);
  if (expect.max_stop_failures !== undefined && metrics.stopFailures > expect.max_stop_failures) failures.push(`Observed ${metrics.stopFailures} stop failures; maximum is ${expect.max_stop_failures}`);
  return failures;
}

export function compareAgentTeamResults(baseline: AgentTeamRunResult, candidate: AgentTeamRunResult): AgentTeamComparisonResult {
  const failures: string[] = [];
  if (baseline.scenario !== candidate.scenario) failures.push(`Scenario mismatch: ${baseline.scenario} vs ${candidate.scenario}`);
  if (candidate.status !== 'passed') failures.push(`Candidate team run status is ${candidate.status}`);
  if (baseline.status === 'unsupported') failures.push('Baseline team run is unsupported and cannot establish a compatibility contract');

  const baselineNames = new Set(baseline.metrics.teammates.map((member) => member.name));
  const candidateNames = new Set(candidate.metrics.teammates.map((member) => member.name));
  for (const name of [...baselineNames].sort()) if (!candidateNames.has(name)) failures.push(`Candidate did not observe baseline teammate: ${name}`);
  if (candidate.metrics.duplicateTeammates.length > baseline.metrics.duplicateTeammates.length) failures.push('Candidate introduced additional duplicate teammate spawns');
  if (candidate.metrics.orphanedTeammates.length > baseline.metrics.orphanedTeammates.length) failures.push('Candidate introduced additional teammates without an observed idle transition');
  if (candidate.metrics.incompleteTaskIds.length > baseline.metrics.incompleteTaskIds.length) failures.push('Candidate introduced additional incomplete team tasks');
  if (candidate.metrics.stopFailures > baseline.metrics.stopFailures) failures.push('Candidate introduced additional stop failures');
  if (candidate.metrics.tasksCompleted < baseline.metrics.tasksCompleted) failures.push(`Candidate completed fewer team tasks (${candidate.metrics.tasksCompleted} < ${baseline.metrics.tasksCompleted})`);

  const baselineDuration = baseline.metrics.coordinationDurationMs;
  const candidateDuration = candidate.metrics.coordinationDurationMs;
  return {
    schemaVersion: 1,
    kind: 'agent-team-comparison',
    passed: failures.length === 0,
    failures,
    baseline,
    candidate,
    deltas: {
      teammateCount: candidate.metrics.teammateCount - baseline.metrics.teammateCount,
      tasksCreated: candidate.metrics.tasksCreated - baseline.metrics.tasksCreated,
      tasksCompleted: candidate.metrics.tasksCompleted - baseline.metrics.tasksCompleted,
      messagesSent: candidate.metrics.messagesSent - baseline.metrics.messagesSent,
      stopFailures: candidate.metrics.stopFailures - baseline.metrics.stopFailures,
      coordinationDurationMs: baselineDuration !== undefined && candidateDuration !== undefined ? candidateDuration - baselineDuration : undefined,
    },
  };
}

function observerScript(): string {
  return `import { appendFile } from 'node:fs/promises';\n` +
    `let raw=''; for await (const chunk of process.stdin) raw += chunk;\n` +
    `let input; try { input=JSON.parse(raw); } catch { process.exit(0); }\n` +
    `const out=process.env.CC_CANARY_TEAM_EVENT_FILE; if (!out) process.exit(0);\n` +
    `const s=v=>typeof v==='string'&&v.length?v:undefined; const ev=s(input.hook_event_name); const tool=s(input.tool_name); const ti=input.tool_input&&typeof input.tool_input==='object'?input.tool_input:{};\n` +
    `let event; if(ev==='TeammateIdle') event={kind:'teammate_idle',teammate:s(input.teammate_name)}; else if(ev==='TaskCreated') event={kind:'task_created',taskId:s(input.task_id),teammate:s(input.teammate_name)}; else if(ev==='TaskCompleted') event={kind:'task_completed',taskId:s(input.task_id),teammate:s(input.teammate_name)}; else if(ev==='StopFailure') event={kind:'stop_failure'}; else if(ev==='PostToolUse'&&tool==='Agent') event={kind:'teammate_spawned',teammate:s(ti.name),agentType:s(ti.subagent_type),model:s(ti.model)}; else if(ev==='PostToolUse'&&tool==='SendMessage') event={kind:'message_sent',recipient:s(ti.recipient)||s(ti.to)};\n` +
    `if(event){ event.at=new Date().toISOString(); await appendFile(out,JSON.stringify(event)+'\\n','utf8'); }\n`;
}

async function readEvents(file: string): Promise<{ events: AgentTeamEvent[]; failures: string[] }> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { events: [], failures: [] };
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_EVENT_BYTES) return { events: [], failures: [`Agent-team observer log exceeded ${MAX_EVENT_BYTES} bytes`] };
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length > MAX_EVENTS) return { events: [], failures: [`Agent-team observer emitted ${lines.length} events; safety limit is ${MAX_EVENTS}`] };
  const events: AgentTeamEvent[] = [];
  const failures: string[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value) || !stringValue(value.kind) || !stringValue(value.at)) throw new Error('invalid shape');
      const kind = value.kind as AgentTeamEventKind;
      if (!['teammate_spawned', 'teammate_idle', 'task_created', 'task_completed', 'message_sent', 'stop_failure'].includes(kind)) throw new Error('unknown kind');
      events.push({
        kind,
        at: value.at as string,
        teammate: stringValue(value.teammate),
        agentType: stringValue(value.agentType),
        model: stringValue(value.model),
        taskId: stringValue(value.taskId),
        recipient: stringValue(value.recipient),
      });
    } catch {
      failures.push(`Malformed agent-team observer event at line ${index + 1}`);
    }
  }
  return { events, failures };
}

async function defaultInteractiveRunner(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<InteractiveProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: 'inherit', windowsHide: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut }); });
  });
}

async function writeResultArtifact(repoRoot: string, result: AgentTeamRunResult): Promise<string> {
  const dir = path.join(repoRoot, '.canary', 'results');
  await mkdir(dir, { recursive: true });
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${safeSlug(result.scenario)}-agent-team.json`);
  const persisted = { ...result };
  delete persisted.artifactPath;
  await writeFile(file, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

export async function runAgentTeam(scenario: AgentTeamScenario, options: RunAgentTeamOptions = {}): Promise<AgentTeamRunResult> {
  if (options.version && options.executableOverride) throw new Error('Use either --version or --executable for team-run, not both.');
  const forbidden = containsForbiddenInteractiveFlag(scenario.claude.args);
  if (forbidden) throw new Error(`Agent-team scenario claude.args contains ${forbidden}, which conflicts with interactive team observation.`);

  const invocationDir = options.cwd ?? process.cwd();
  const repoRoot = await getRepoRoot(invocationDir);
  const gitCommit = await resolveCommit(repoRoot, options.gitRefOverride ?? 'HEAD');
  let executable = options.executableOverride ?? scenario.claude.executable;
  let claudeVersion: string | undefined;
  if (options.version) {
    const installed = await installClaudeVersion(options.version, { platform: options.platform, onStatus: options.onStatus });
    executable = installed.executablePath;
    claudeVersion = installed.version;
  }

  const tty = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) {
    const result: AgentTeamRunResult = {
      schemaVersion: 1,
      kind: 'agent-team-run',
      canaryVersion: CANARY_VERSION,
      experimental: true,
      status: 'unsupported',
      scenario: scenario.name,
      executable,
      claudeVersion,
      gitCommit,
      exitCode: null,
      signal: null,
      timedOut: false,
      failures: ['Real Claude Code agent teams require an interactive TTY; non-interactive/print-mode runs only create ordinary subagents.'],
      metrics: aggregateAgentTeamEvents([]),
      events: [],
      createdAt: new Date().toISOString(),
    };
    result.artifactPath = await writeResultArtifact(repoRoot, result);
    return result;
  }

  const worktree = await createDetachedWorktree(repoRoot, gitCommit);
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'claude-canary-team-'));
  const eventsFile = path.join(runtimeRoot, 'events.jsonl');
  const observerFile = path.join(runtimeRoot, 'observer.mjs');
  const settingsFile = path.join(runtimeRoot, 'settings.json');
  try {
    await writeFile(observerFile, observerScript(), 'utf8');
    const command = `${shellQuote(process.execPath)} ${shellQuote(observerFile)}`;
    const commandHook = { type: 'command', command, timeout: 5 };
    const settings = {
      hooks: {
        TeammateIdle: [{ hooks: [commandHook] }],
        TaskCreated: [{ hooks: [commandHook] }],
        TaskCompleted: [{ hooks: [commandHook] }],
        StopFailure: [{ hooks: [commandHook] }],
        PostToolUse: [{ matcher: 'Agent|SendMessage', hooks: [commandHook] }],
      },
    };
    await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

    const args = [scenario.prompt, '--settings', settingsFile, '--teammate-mode', 'in-process'];
    if (scenario.claude.model) args.push('--model', scenario.claude.model);
    if (scenario.claude.permission_mode) args.push('--permission-mode', scenario.claude.permission_mode);
    args.push(...scenario.claude.args);
    const runner = options.interactiveRunner ?? defaultInteractiveRunner;
    const processResult = await runner(executable, args, {
      cwd: worktree.path,
      timeoutMs: scenario.claude.timeout_seconds * 1000,
      env: {
        ...process.env,
        ...scenario.claude.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CC_CANARY_TEAM_EVENT_FILE: eventsFile,
      },
    });

    const observed = await readEvents(eventsFile);
    const metrics = aggregateAgentTeamEvents(observed.events);
    const failures = [...observed.failures];
    if (processResult.timedOut) failures.push(`Interactive Claude team session timed out after ${scenario.claude.timeout_seconds}s`);
    if (processResult.code !== 0 && processResult.code !== null) failures.push(`Interactive Claude team session exited with code ${processResult.code}`);
    failures.push(...evaluateAgentTeamExpectations(scenario, metrics));
    if (metrics.teammateCount === 0) failures.push('No real agent-team teammate activity was observed; verify that the selected Claude Code release supports agent teams and that the prompt explicitly creates a team.');

    const result: AgentTeamRunResult = {
      schemaVersion: 1,
      kind: 'agent-team-run',
      canaryVersion: CANARY_VERSION,
      experimental: true,
      status: failures.length ? 'failed' : 'passed',
      scenario: scenario.name,
      executable,
      claudeVersion,
      gitCommit,
      exitCode: processResult.code,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      failures,
      metrics,
      events: observed.events,
      createdAt: new Date().toISOString(),
    };
    result.artifactPath = await writeResultArtifact(repoRoot, result);
    return result;
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
    await worktree.cleanup();
  }
}

export async function loadAgentTeamResult(file: string): Promise<AgentTeamRunResult> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'agent-team-run') throw new Error(`Not a Canary agent-team result: ${file}`);
  return value as unknown as AgentTeamRunResult;
}

export function formatAgentTeamRun(result: AgentTeamRunResult): string {
  const lines = [
    'Claude Code Canary — agent-team run',
    '',
    `Status: ${result.status.toUpperCase()}`,
    `Scenario: ${result.scenario}`,
    `Teammates: ${result.metrics.teammateCount}`,
    `Tasks: ${result.metrics.tasksCompleted}/${result.metrics.tasksCreated} completed`,
    `Messages observed: ${result.metrics.messagesSent}`,
    `Stop failures: ${result.metrics.stopFailures}`,
  ];
  if (result.metrics.teammates.length) lines.push(`Members: ${result.metrics.teammates.map((member) => member.name).join(', ')}`);
  if (result.failures.length) lines.push('', 'Failures:', ...result.failures.map((failure) => `- ${failure}`));
  if (result.artifactPath) lines.push('', `Artifact: ${result.artifactPath}`);
  return lines.join('\n');
}

export function formatAgentTeamComparison(result: AgentTeamComparisonResult): string {
  const lines = [
    'Claude Code Canary — agent-team comparison',
    '',
    `Result: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Scenario: ${result.candidate.scenario}`,
    `Teammates Δ: ${result.deltas.teammateCount >= 0 ? '+' : ''}${result.deltas.teammateCount}`,
    `Completed tasks Δ: ${result.deltas.tasksCompleted >= 0 ? '+' : ''}${result.deltas.tasksCompleted}`,
    `Messages Δ: ${result.deltas.messagesSent >= 0 ? '+' : ''}${result.deltas.messagesSent}`,
  ];
  if (result.failures.length) lines.push('', 'Regressions:', ...result.failures.map((failure) => `- ${failure}`));
  return lines.join('\n');
}
