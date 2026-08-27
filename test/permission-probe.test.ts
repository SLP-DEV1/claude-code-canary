import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/config.js';
import { mergePermissionProbeMetrics, PERMISSION_PROMPT_TOOL, preparePermissionProbe } from '../src/permission-probe.js';
import type { RunMetrics } from '../src/types.js';

function runProbeServer(script: string, env: NodeJS.ProcessEnv, messages: unknown[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`probe exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
    child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`);
  });
}

const baseMetrics: RunMetrics = {
  toolCalls: 1,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 15,
  hookEvents: [],
  parseErrors: 0,
};

describe('headless permission probe', () => {
  it('creates an isolated plugin and returns the original tool input unchanged', async () => {
    const scenario = parseScenario({
      version: 1,
      name: 'permissions',
      prompt: 'x',
      expect: { permissions: { max_prompts: 0, max_denied: 0 } },
    });
    const probe = await preparePermissionProbe(scenario);
    expect(probe).toBeDefined();
    if (!probe) throw new Error('probe missing');

    try {
      expect(probe.extraClaudeArgs).toEqual(expect.arrayContaining([
        '--plugin-dir',
        probe.runtimeDir,
        '--permission-prompt-tool',
        PERMISSION_PROMPT_TOOL,
      ]));

      const server = path.join(probe.runtimeDir, 'scripts', 'permission-server.cjs');
      const stdout = await runProbeServer(server, probe.env, [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'permission_request',
            arguments: { tool_name: 'Bash', tool_input: { command: 'echo secret-value' } },
          },
        },
      ]);

      const responses = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(responses).toHaveLength(3);
      const callResult = responses.find((response) => response.id === 3) as { result: { content: Array<{ text: string }> } };
      expect(JSON.parse(callResult.result.content[0].text)).toEqual({
        behavior: 'allow',
        updatedInput: { command: 'echo secret-value' },
      });

      const measured = await probe.collect();
      expect(measured).toEqual({
        permissionPrompts: 1,
        permissionDenied: 0,
        permissionRequests: [{ toolName: 'Bash' }],
      });
      expect(JSON.stringify(measured)).not.toContain('secret-value');

      expect(mergePermissionProbeMetrics(baseMetrics, measured)).toMatchObject({
        permissionPrompts: 1,
        permissionDenied: 0,
        permissionRequests: [{ toolName: 'Bash' }],
      });
    } finally {
      await probe.cleanup();
    }
  });

  it('does not install instrumentation when no permission metric is configured', async () => {
    const scenario = parseScenario({ version: 1, name: 'plain', prompt: 'x' });
    await expect(preparePermissionProbe(scenario)).resolves.toBeUndefined();
  });
});
