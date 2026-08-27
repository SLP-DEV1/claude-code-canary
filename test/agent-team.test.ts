import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aggregateAgentTeamEvents,
  compareAgentTeamResults,
  evaluateAgentTeamExpectations,
  parseAgentTeamScenario,
  runAgentTeam,
  type AgentTeamEvent,
  type AgentTeamRunResult,
} from '../src/agent-team.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function gitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-team-test-'));
  roots.push(root);
  await execFileAsync('git', ['init', '-q'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Canary Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), 'fixture\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const at = (offset: number) => new Date(Date.UTC(2026, 7, 27, 18, 0, offset)).toISOString();

function result(metrics: ReturnType<typeof aggregateAgentTeamEvents>, status: AgentTeamRunResult['status'] = 'passed'): AgentTeamRunResult {
  return {
    schemaVersion: 1,
    kind: 'agent-team-run',
    canaryVersion: '1.2.0-dev',
    experimental: true,
    status,
    scenario: 'team-review',
    executable: 'claude',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    exitCode: 0,
    signal: null,
    timedOut: false,
    failures: [],
    metrics,
    events: [],
    createdAt: at(0),
  };
}

describe('agent-team regression observation', () => {
  it('validates dedicated team scenarios without changing the normal scenario schema', () => {
    const parsed = parseAgentTeamScenario({
      version: 1,
      name: 'team-review',
      prompt: 'Create a team with reviewer and tester, then coordinate a read-only review.',
      expect: {
        expected_teammates: ['reviewer', 'tester'],
        min_tasks_completed: 2,
        require_all_tasks_completed: true,
      },
    });
    expect(parsed.claude.timeout_seconds).toBe(1800);
    expect(parsed.expect?.expected_teammates).toEqual(['reviewer', 'tester']);
    expect(() => parseAgentTeamScenario({ version: 1, name: 'bad', prompt: '' })).toThrow(/agent-team scenario/i);
  });

  it('aggregates only privacy-safe team lifecycle facts', () => {
    const events: AgentTeamEvent[] = [
      { kind: 'teammate_spawned', at: at(0), teammate: 'reviewer', agentType: 'Explore', model: 'sonnet' },
      { kind: 'teammate_spawned', at: at(1), teammate: 'tester', agentType: 'general-purpose' },
      { kind: 'task_created', at: at(2), taskId: '1', teammate: 'reviewer' },
      { kind: 'task_created', at: at(3), taskId: '2', teammate: 'tester' },
      { kind: 'message_sent', at: at(4), recipient: 'tester' },
      { kind: 'task_completed', at: at(5), taskId: '1', teammate: 'reviewer' },
      { kind: 'teammate_idle', at: at(6), teammate: 'reviewer' },
    ];
    const metrics = aggregateAgentTeamEvents(events);
    expect(metrics.teammateCount).toBe(2);
    expect(metrics.teammates.map((member) => member.name)).toEqual(['reviewer', 'tester']);
    expect(metrics.tasksCreated).toBe(2);
    expect(metrics.tasksCompleted).toBe(1);
    expect(metrics.incompleteTaskIds).toEqual(['2']);
    expect(metrics.orphanedTeammates).toEqual(['tester']);
    expect(metrics.messagesSent).toBe(1);
    expect(metrics.coordinationDurationMs).toBe(6000);
  });

  it('evaluates deterministic team expectations', () => {
    const scenario = parseAgentTeamScenario({
      version: 1,
      name: 'team-review',
      prompt: 'Team review.',
      expect: {
        expected_teammates: ['reviewer', 'tester'],
        deny_unexpected_teammates: true,
        min_tasks_completed: 2,
        min_messages_sent: 1,
        require_all_tasks_completed: true,
        require_all_teammates_idle: true,
      },
    });
    const metrics = aggregateAgentTeamEvents([
      { kind: 'teammate_spawned', at: at(0), teammate: 'reviewer' },
      { kind: 'task_created', at: at(1), taskId: '1' },
    ]);
    const failures = evaluateAgentTeamExpectations(scenario, metrics);
    expect(failures.join('\n')).toMatch(/tester/);
    expect(failures.join('\n')).toMatch(/completed tasks/i);
    expect(failures.join('\n')).toMatch(/Incomplete team tasks/i);
    expect(failures.join('\n')).toMatch(/never observed idle/i);
  });

  it('detects structural team regressions between saved results', () => {
    const baseline = result(aggregateAgentTeamEvents([
      { kind: 'teammate_spawned', at: at(0), teammate: 'reviewer' },
      { kind: 'teammate_spawned', at: at(1), teammate: 'tester' },
      { kind: 'task_created', at: at(2), taskId: '1' },
      { kind: 'task_completed', at: at(3), taskId: '1' },
      { kind: 'teammate_idle', at: at(4), teammate: 'reviewer' },
      { kind: 'teammate_idle', at: at(5), teammate: 'tester' },
    ]));
    const candidate = result(aggregateAgentTeamEvents([
      { kind: 'teammate_spawned', at: at(0), teammate: 'reviewer' },
      { kind: 'task_created', at: at(1), taskId: '1' },
    ]));
    const compared = compareAgentTeamResults(baseline, candidate);
    expect(compared.passed).toBe(false);
    expect(compared.failures.join('\n')).toMatch(/baseline teammate: tester/i);
    expect(compared.failures.join('\n')).toMatch(/incomplete team tasks/i);
    expect(compared.failures.join('\n')).toMatch(/fewer team tasks/i);
  });

  it('returns an explicit unsupported artifact without launching Claude when no TTY exists', async () => {
    const root = await gitRepo();
    const scenario = parseAgentTeamScenario({ version: 1, name: 'team-review', prompt: 'Create a team.' });
    let launched = false;
    const run = await runAgentTeam(scenario, {
      cwd: root,
      isTTY: false,
      interactiveRunner: async () => {
        launched = true;
        return { code: 0, signal: null, timedOut: false };
      },
    });
    expect(launched).toBe(false);
    expect(run.status).toBe('unsupported');
    expect(run.failures.join('\n')).toMatch(/interactive TTY/i);
    expect(run.artifactPath).toMatch(/agent-team\.json$/);
  });

  it('runs through the injectable interactive path and evaluates observed hook events', async () => {
    const root = await gitRepo();
    const scenario = parseAgentTeamScenario({
      version: 1,
      name: 'team-review',
      prompt: 'Create reviewer and tester teammates.',
      expect: {
        expected_teammates: ['reviewer', 'tester'],
        min_tasks_completed: 1,
      },
    });
    const run = await runAgentTeam(scenario, {
      cwd: root,
      isTTY: true,
      interactiveRunner: async (_executable, args, options) => {
        expect(args[0]).toContain('reviewer');
        expect(args).toContain('--teammate-mode');
        expect(options.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
        const eventFile = options.env.CC_CANARY_TEAM_EVENT_FILE;
        expect(typeof eventFile).toBe('string');
        await mkdir(path.dirname(eventFile as string), { recursive: true });
        await writeFile(eventFile as string, [
          JSON.stringify({ kind: 'teammate_spawned', at: at(0), teammate: 'reviewer', agentType: 'Explore' }),
          JSON.stringify({ kind: 'teammate_spawned', at: at(1), teammate: 'tester', agentType: 'general-purpose' }),
          JSON.stringify({ kind: 'task_created', at: at(2), taskId: '1' }),
          JSON.stringify({ kind: 'task_completed', at: at(3), taskId: '1' }),
        ].join('\n') + '\n', 'utf8');
        return { code: 0, signal: null, timedOut: false };
      },
    });
    expect(run.status).toBe('passed');
    expect(run.metrics.teammateCount).toBe(2);
    expect(run.metrics.tasksCompleted).toBe(1);
  });

  it('rejects flags that would silently downgrade the run to print mode or replace observer settings', async () => {
    const root = await gitRepo();
    const scenario = parseAgentTeamScenario({
      version: 1,
      name: 'bad-team',
      prompt: 'Team.',
      claude: { args: ['-p'], timeout_seconds: 30, env: {} },
    });
    await expect(runAgentTeam(scenario, { cwd: root, isTTY: false })).rejects.toThrow(/conflicts with interactive team observation/i);
  });
});
