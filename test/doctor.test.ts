import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProviderConfiguration, findExecutable, runDoctorReport } from '../src/doctor.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-doctor-'));
  temporary.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

describe('extension compatibility doctor', () => {
  it('detects provider mode using presence only', () => {
    const env = {
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: 'false',
      ANTHROPIC_API_KEY: 'do-not-leak',
    } satisfies NodeJS.ProcessEnv;
    const report = detectProviderConfiguration(env);
    expect(report.mode).toBe('ambiguous');
    expect(report.indicators).toEqual(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']);
    expect(report.credentialsPresent.anthropicApiKey).toBe(true);
    expect(JSON.stringify(report)).not.toContain('do-not-leak');
    expect(JSON.stringify(report)).not.toContain('false');
  });

  it('recognizes custom base URL without persisting its value', () => {
    const report = detectProviderConfiguration({ ANTHROPIC_BASE_URL: 'https://secret-gateway.example/v1' });
    expect(report.mode).toBe('custom-base-url');
    expect(report.indicators).toEqual(['ANTHROPIC_BASE_URL']);
    expect(JSON.stringify(report)).not.toContain('secret-gateway.example');
  });

  it('resolves explicit executables cross-platform', async () => {
    expect(await findExecutable(process.execPath, process.cwd(), {})).toBe(process.execPath);
  });

  it('reports plugin, LSP and project MCP compatibility without leaking secret values', async () => {
    const root = await tempRepo();
    await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'doctor-fixture' }), 'utf8');
    await writeFile(path.join(root, '.lsp.json'), JSON.stringify({
      typescript: {
        command: process.execPath,
        extensionToLanguage: { '.ts': 'typescript' },
      },
    }), 'utf8');
    await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        local: { type: 'stdio', command: process.execPath, args: ['--version'] },
        remote: { type: 'http', url: 'https://private-mcp.example/super-secret-path', headers: { Authorization: 'Bearer never-print-me' } },
      },
    }), 'utf8');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: 'https://private-gateway.example/v1',
      ANTHROPIC_API_KEY: 'sk-ant-never-print-me',
      CI: 'true',
    };
    const report = await runDoctorReport(root, {
      claudeExecutable: process.execPath,
      plugins: [root],
      env,
      isTTY: false,
    });

    expect(report.ok).toBe(true);
    expect(report.claude.available).toBe(true);
    expect(report.provider.mode).toBe('custom-base-url');
    expect(report.provider.credentialsPresent.anthropicApiKey).toBe(true);
    expect(report.runtime.ci).toBe(true);
    expect(report.plugins).toHaveLength(1);
    expect(report.plugins[0]?.componentTypes).toContain('lsp');
    expect(report.requiredBinaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'lsp', name: 'typescript', available: true }),
      expect.objectContaining({ kind: 'mcp', name: 'local', available: true }),
    ]));
    expect(report.mcp.projectConfig).toBe(true);
    expect(report.mcp.transports.stdio).toBe(1);
    expect(report.mcp.transports.http).toBe(1);

    const serialized = JSON.stringify(report);
    for (const secret of [
      'private-mcp.example',
      'super-secret-path',
      'Bearer never-print-me',
      'private-gateway.example',
      'sk-ant-never-print-me',
    ]) expect(serialized).not.toContain(secret);
  });

  it('fails the preflight when an LSP executable is missing', async () => {
    const root = await tempRepo();
    await mkdir(path.join(root, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'missing-lsp' }), 'utf8');
    await writeFile(path.join(root, '.lsp.json'), JSON.stringify({
      missing: {
        command: 'canary-doctor-executable-that-does-not-exist',
        extensionToLanguage: { '.fake': 'fake' },
      },
    }), 'utf8');

    const report = await runDoctorReport(root, {
      claudeExecutable: process.execPath,
      plugins: [root],
      env: { ...process.env },
      isTTY: true,
      inspectMcp: false,
    });
    expect(report.ok).toBe(false);
    expect(report.requiredBinaries).toContainEqual(expect.objectContaining({
      kind: 'lsp',
      name: 'missing',
      available: false,
    }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'LSP binary missing-lsp/missing', ok: false }));
  });

  it('warns on presence-sensitive provider flags and non-TTY agent teams without exposing values', async () => {
    const root = await tempRepo();
    const report = await runDoctorReport(root, {
      claudeExecutable: process.execPath,
      env: {
        ...process.env,
        CLAUDE_CODE_USE_BEDROCK: 'false',
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      },
      isTTY: false,
      autoDiscoverPlugin: false,
      inspectMcp: false,
    });
    expect(report.provider.mode).toBe('bedrock');
    expect(report.features.agentTeams).toBe(true);
    expect(report.warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'provider.truthy-flag',
      'agent-teams.no-tty',
      'agent-teams.provider-variance',
    ]));
    expect(JSON.stringify(report)).not.toContain('CLAUDE_CODE_USE_BEDROCK=false');
  });
});
