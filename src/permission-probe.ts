import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Scenario } from './config.js';
import type { PermissionRequestTrace, RunMetrics } from './types.js';

const PLUGIN_NAME = 'canaryprobe';
const MCP_SERVER_NAME = 'canary_permissions';
export const PERMISSION_PROMPT_TOOL = `mcp__${MCP_SERVER_NAME}__permission_request`;

export interface PermissionProbeMetrics {
  permissionPrompts: number;
  permissionDenied: number;
  permissionRequests: PermissionRequestTrace[];
}

export interface PreparedPermissionProbe {
  runtimeDir: string;
  extraClaudeArgs: string[];
  env: NodeJS.ProcessEnv;
  collect: () => Promise<PermissionProbeMetrics>;
  cleanup: () => Promise<void>;
}

function needsPromptProbe(scenario: Scenario): boolean {
  return Boolean(
    scenario.expect?.permissions?.max_prompts !== undefined
    || (scenario.expect?.permissions?.deny_prompted_tools?.length ?? 0) > 0
    || scenario.regressions?.max_permission_prompts_increase !== undefined,
  );
}

function needsDeniedProbe(scenario: Scenario): boolean {
  return Boolean(
    scenario.expect?.permissions?.max_denied !== undefined
    || scenario.regressions?.max_permission_denied_increase !== undefined,
  );
}

export function needsPermissionProbe(scenario: Scenario): boolean {
  return needsPromptProbe(scenario) || needsDeniedProbe(scenario);
}

function permissionServerSource(): string {
  return String.raw`'use strict';
const fs = require('node:fs');
const traceFile = process.env.CLAUDE_CANARY_PERMISSION_PROMPT_TRACE;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function trace(toolName) {
  if (!traceFile) return;
  fs.appendFileSync(traceFile, JSON.stringify({ toolName: typeof toolName === 'string' ? toolName : undefined }) + '\n', 'utf8');
}

function handle(message) {
  if (!isObject(message) || message.jsonrpc !== '2.0') return;
  const id = message.id;
  const method = message.method;

  if (method === 'initialize' && id !== undefined) {
    const requested = isObject(message.params) && typeof message.params.protocolVersion === 'string'
      ? message.params.protocolVersion
      : '2025-06-18';
    send({ jsonrpc: '2.0', id, result: { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: { name: 'claude-canary-permission-probe', version: '1.0.0' } } });
    return;
  }

  if (method === 'ping' && id !== undefined) {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list' && id !== undefined) {
    send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'permission_request', description: 'Claude Canary headless permission probe', inputSchema: { type: 'object', additionalProperties: true } }] } });
    return;
  }

  if (method === 'tools/call' && id !== undefined) {
    const params = isObject(message.params) ? message.params : {};
    if (params.name !== 'permission_request') {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool' } });
      return;
    }

    const args = isObject(params.arguments) ? params.arguments : {};
    const toolName = typeof args.tool_name === 'string' ? args.tool_name
      : typeof args.toolName === 'string' ? args.toolName
      : typeof args.tool === 'string' ? args.tool
      : undefined;
    const toolInput = isObject(args.tool_input) ? args.tool_input
      : isObject(args.toolInput) ? args.toolInput
      : isObject(args.input) ? args.input
      : undefined;

    trace(toolName);

    const decision = toolInput
      ? { behavior: 'allow', updatedInput: toolInput }
      : { behavior: 'deny', message: 'Claude Canary refused to alter a permission request whose original tool input was unavailable.' };

    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }], isError: false } });
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch (error) {
      process.stderr.write('permission probe JSON error: ' + String(error) + '\n');
    }
  }
});
`;
}

function deniedHookSource(): string {
  return String.raw`'use strict';
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const value = JSON.parse(input);
    const traceFile = process.env.CLAUDE_CANARY_PERMISSION_DENIED_TRACE;
    if (!traceFile) return;
    const record = {
      toolName: typeof value.tool_name === 'string' ? value.tool_name : undefined,
      toolUseId: typeof value.tool_use_id === 'string' ? value.tool_use_id : undefined,
      permissionMode: typeof value.permission_mode === 'string' ? value.permission_mode : undefined,
    };
    fs.appendFileSync(traceFile, JSON.stringify(record) + '\n', 'utf8');
  } catch (error) {
    process.stderr.write('permission denied probe error: ' + String(error) + '\n');
    process.exitCode = 1;
  }
});
`;
}

async function readJsonLines(file: string): Promise<Record<string, unknown>[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed as Record<string, unknown>);
  }
  return rows;
}

function traceValue(row: Record<string, unknown>, key: string): string | undefined {
  return typeof row[key] === 'string' && row[key] ? row[key] as string : undefined;
}

export async function preparePermissionProbe(scenario: Scenario): Promise<PreparedPermissionProbe | undefined> {
  const promptProbe = needsPromptProbe(scenario);
  const deniedProbe = needsDeniedProbe(scenario);
  if (!promptProbe && !deniedProbe) return undefined;

  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'claude-canary-permissions-'));
  const scriptsDir = path.join(runtimeDir, 'scripts');
  await mkdir(scriptsDir, { recursive: true });

  const promptTrace = path.join(runtimeDir, 'permission-prompts.jsonl');
  const deniedTrace = path.join(runtimeDir, 'permission-denied.jsonl');
  const extraClaudeArgs: string[] = [];
  const env: NodeJS.ProcessEnv = {};

  if (promptProbe) {
    const serverScript = path.join(scriptsDir, 'permission-server.cjs');
    const mcpConfig = path.join(runtimeDir, 'mcp.json');
    await writeFile(serverScript, permissionServerSource(), 'utf8');
    await writeFile(mcpConfig, `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: process.execPath, args: [serverScript] } } }, null, 2)}\n`, 'utf8');
    await writeFile(promptTrace, '', 'utf8');
    env.CLAUDE_CANARY_PERMISSION_PROMPT_TRACE = promptTrace;
    // Use an explicit --mcp-config instead of a plugin-bundled MCP server so the
    // probe remains available when the tested scenario uses --strict-mcp-config.
    extraClaudeArgs.push('--mcp-config', mcpConfig, '--permission-prompt-tool', PERMISSION_PROMPT_TOOL);
  }

  if (deniedProbe) {
    const manifestDir = path.join(runtimeDir, '.claude-plugin');
    const hooksDir = path.join(runtimeDir, 'hooks');
    await Promise.all([mkdir(manifestDir, { recursive: true }), mkdir(hooksDir, { recursive: true })]);
    await writeFile(path.join(manifestDir, 'plugin.json'), `${JSON.stringify({ name: PLUGIN_NAME, version: '1.0.0', description: 'Ephemeral Claude Canary permission instrumentation' }, null, 2)}\n`, 'utf8');
    const hookScript = path.join(scriptsDir, 'permission-denied.cjs');
    await writeFile(hookScript, deniedHookSource(), 'utf8');
    await writeFile(path.join(hooksDir, 'hooks.json'), `${JSON.stringify({ hooks: { PermissionDenied: [{ hooks: [{ type: 'command', command: process.execPath, args: [hookScript] }] }] } }, null, 2)}\n`, 'utf8');
    await writeFile(deniedTrace, '', 'utf8');
    env.CLAUDE_CANARY_PERMISSION_DENIED_TRACE = deniedTrace;
    extraClaudeArgs.push('--plugin-dir', runtimeDir);
  }

  return {
    runtimeDir,
    extraClaudeArgs,
    env,
    collect: async () => {
      const promptRows = promptProbe ? await readJsonLines(promptTrace) : [];
      const deniedRows = deniedProbe ? await readJsonLines(deniedTrace) : [];
      return {
        permissionPrompts: promptRows.length,
        permissionDenied: deniedRows.length,
        permissionRequests: promptRows.map((row) => ({ toolName: traceValue(row, 'toolName') })),
      };
    },
    cleanup: async () => { await rm(runtimeDir, { recursive: true, force: true }); },
  };
}

export function mergePermissionProbeMetrics(metrics: RunMetrics, probe: PermissionProbeMetrics | undefined): RunMetrics {
  if (!probe) return metrics;
  return {
    ...metrics,
    permissionPrompts: probe.permissionPrompts,
    permissionDenied: probe.permissionDenied,
    permissionRequests: probe.permissionRequests,
  };
}
