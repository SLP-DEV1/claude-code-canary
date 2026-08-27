import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { CANARY_VERSION } from './version.js';

const nameExpectations = z.object({
  require: z.array(z.string().min(1)).default([]),
  deny: z.array(z.string().min(1)).default([]),
  exact: z.boolean().default(false),
}).strict();

const toolExpectations = nameExpectations.extend({
  require_read_only: z.array(z.string().min(1)).default([]),
  deny_destructive: z.boolean().default(false),
}).strict();

const capabilityExpectations = z.object({
  tools_list_changed: z.boolean().optional(),
  prompts_list_changed: z.boolean().optional(),
  resources_list_changed: z.boolean().optional(),
  resources_subscribe: z.boolean().optional(),
}).strict();

export const McpContractSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  server: z.object({
    transport: z.literal('stdio').default('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).default({}),
    timeout_seconds: z.number().int().positive().max(300).default(30),
    protocol_version: z.string().min(1).default('2025-11-25'),
  }).strict(),
  expect: z.object({
    tools: toolExpectations.optional(),
    prompts: nameExpectations.optional(),
    resources: nameExpectations.optional(),
    resource_templates: nameExpectations.optional(),
    capabilities: capabilityExpectations.optional(),
  }).strict().optional(),
}).strict();

export type McpContract = z.infer<typeof McpContractSchema>;

export interface McpToolSnapshot {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface McpPromptSnapshot {
  name: string;
  title?: string;
  description?: string;
  arguments?: unknown[];
}

export interface McpResourceSnapshot {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplateSnapshot {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpContractSnapshot {
  schemaVersion: 1;
  contract: string;
  capturedAt: string;
  requestedProtocolVersion: string;
  protocolVersion: string;
  serverInfo?: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  tools: McpToolSnapshot[];
  prompts: McpPromptSnapshot[];
  resources: McpResourceSnapshot[];
  resourceTemplates: McpResourceTemplateSnapshot[];
  observedNotifications: {
    toolsListChanged: number;
    promptsListChanged: number;
    resourcesListChanged: number;
  };
  fingerprint: string;
}

export interface McpExpectationResult {
  passed: boolean;
  failures: string[];
}

export interface McpComparisonResult {
  passed: boolean;
  breakingChanges: string[];
  nonBreakingChanges: string[];
}

export interface McpCheckResult {
  contract: McpContract;
  snapshot: McpContractSnapshot;
  expectations: McpExpectationResult;
  baseline?: McpContractSnapshot;
  comparison?: McpComparisonResult;
  passed: boolean;
  snapshotPath?: string;
}

export interface McpSnapshotOptions {
  cwd?: string;
  output?: string;
}

export interface McpCheckOptions {
  cwd?: string;
  baseline?: string;
  requireBaseline?: boolean;
  saveSnapshot?: string;
}

export interface McpCompareOptions {
  cwd?: string;
}

type JsonRpcId = number;
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) output[key] = normalizeJson(child);
  }
  return output;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function valueAt(root: Record<string, unknown>, pathParts: string[]): unknown {
  let value: unknown = root;
  for (const part of pathParts) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] as string : undefined;
}

function normalizeTool(value: unknown): McpToolSnapshot {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) throw new Error('MCP tools/list returned a tool without a valid name.');
  if (!isRecord(value.inputSchema)) throw new Error(`MCP tool ${value.name} is missing a valid inputSchema.`);
  return {
    name: value.name,
    title: optionalString(value, 'title'),
    description: optionalString(value, 'description'),
    inputSchema: normalizeJson(value.inputSchema),
    outputSchema: value.outputSchema === undefined ? undefined : normalizeJson(value.outputSchema),
    annotations: isRecord(value.annotations) ? normalizeJson(value.annotations) as Record<string, unknown> : undefined,
  };
}

function normalizePrompt(value: unknown): McpPromptSnapshot {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) throw new Error('MCP prompts/list returned a prompt without a valid name.');
  return {
    name: value.name,
    title: optionalString(value, 'title'),
    description: optionalString(value, 'description'),
    arguments: Array.isArray(value.arguments) ? normalizeJson(value.arguments) as unknown[] : undefined,
  };
}

function normalizeResource(value: unknown): McpResourceSnapshot {
  if (!isRecord(value) || typeof value.uri !== 'string' || !value.uri) throw new Error('MCP resources/list returned a resource without a valid uri.');
  return {
    uri: value.uri,
    name: optionalString(value, 'name'),
    title: optionalString(value, 'title'),
    description: optionalString(value, 'description'),
    mimeType: optionalString(value, 'mimeType'),
  };
}

function normalizeResourceTemplate(value: unknown): McpResourceTemplateSnapshot {
  if (!isRecord(value) || typeof value.uriTemplate !== 'string' || !value.uriTemplate) {
    throw new Error('MCP resources/templates/list returned a template without a valid uriTemplate.');
  }
  return {
    uriTemplate: value.uriTemplate,
    name: optionalString(value, 'name'),
    title: optionalString(value, 'title'),
    description: optionalString(value, 'description'),
    mimeType: optionalString(value, 'mimeType'),
  };
}

class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private buffer = '';
  private closed = false;
  private stderr = '';
  readonly notifications = {
    toolsListChanged: 0,
    promptsListChanged: 0,
    resourcesListChanged: 0,
  };

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, private readonly timeoutMs: number) {
    this.child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.consume(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      if (this.stderr.length < 64 * 1024) this.stderr += chunk.slice(0, 64 * 1024 - this.stderr.length);
    });
    this.child.on('error', (error) => this.failAll(new Error(`Could not start MCP server: ${error.message}`)));
    this.child.on('close', (code, signal) => {
      this.closed = true;
      if (this.pending.size > 0) {
        const detail = this.stderr.trim() ? ` stderr: ${this.stderr.trim()}` : '';
        this.failAll(new Error(`MCP server exited before replying (code=${String(code)}, signal=${String(signal)}).${detail}`));
      }
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.failAll(new Error(`MCP server wrote non-JSON data to stdout: ${line.slice(0, 200)}`));
        this.child.kill('SIGKILL');
        return;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || message.jsonrpc !== '2.0') return;
    if (typeof message.method === 'string') {
      if (message.method === 'notifications/tools/list_changed') this.notifications.toolsListChanged += 1;
      if (message.method === 'notifications/prompts/list_changed') this.notifications.promptsListChanged += 1;
      if (message.method === 'notifications/resources/list_changed') this.notifications.resourcesListChanged += 1;
      if (message.id !== undefined) {
        if (message.method === 'ping') this.write({ jsonrpc: '2.0', id: message.id, result: {} });
        else this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by Canary contract inspector' } });
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const code = typeof message.error.code === 'number' ? message.error.code : 'unknown';
      const text = typeof message.error.message === 'string' ? message.error.message : 'MCP request failed';
      pending.reject(new Error(`MCP JSON-RPC error ${String(code)}: ${text}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private write(message: unknown): void {
    if (this.closed || this.child.stdin.destroyed) throw new Error('MCP server stdin is closed.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${this.timeoutMs}ms.`));
        this.child.kill('SIGKILL');
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.closed) this.child.kill('SIGKILL');
        resolve();
      }, 250);
      timer.unref();
      this.child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function parseContract(value: unknown): McpContract {
  const parsed = McpContractSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n');
  throw new Error(`Invalid MCP contract:\n${details}`);
}

export async function loadMcpContract(contractPath: string): Promise<McpContract> {
  let raw: string;
  try {
    raw = await readFile(contractPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read MCP contract ${contractPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseContract(YAML.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid MCP contract:')) throw error;
    throw new Error(`Could not parse MCP contract ${contractPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function collectPages(client: StdioMcpClient, method: string, key: string): Promise<unknown[]> {
  const output: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await client.request(method, cursor ? { cursor } : {});
    if (!isRecord(result)) throw new Error(`MCP ${method} returned a non-object result.`);
    const values = result[key];
    if (!Array.isArray(values)) throw new Error(`MCP ${method} result is missing ${key}.`);
    output.push(...values);
    const nextCursor = result.nextCursor;
    if (nextCursor === undefined || nextCursor === null || nextCursor === '') return output;
    if (typeof nextCursor !== 'string') throw new Error(`MCP ${method} returned an invalid nextCursor.`);
    cursor = nextCursor;
  }
  throw new Error(`MCP ${method} exceeded 100 pagination pages.`);
}

function compatibilitySurface(snapshot: Omit<McpContractSnapshot, 'fingerprint'> | McpContractSnapshot): unknown {
  return {
    protocolVersion: snapshot.protocolVersion,
    capabilities: normalizeJson(snapshot.capabilities),
    tools: snapshot.tools.map((tool) => ({
      name: tool.name,
      inputSchema: normalizeJson(tool.inputSchema),
      outputSchema: normalizeJson(tool.outputSchema),
      annotations: normalizeJson(tool.annotations),
    })),
    prompts: snapshot.prompts.map((prompt) => ({ name: prompt.name, arguments: normalizeJson(prompt.arguments) })),
    resources: snapshot.resources.map((resource) => ({ uri: resource.uri, mimeType: resource.mimeType })),
    resourceTemplates: snapshot.resourceTemplates.map((template) => ({ uriTemplate: template.uriTemplate, mimeType: template.mimeType })),
  };
}

export async function inspectMcpContract(contract: McpContract, options: { cwd?: string; contractPath?: string } = {}): Promise<McpContractSnapshot> {
  const base = options.contractPath ? path.dirname(path.resolve(options.contractPath)) : path.resolve(options.cwd ?? process.cwd());
  const serverCwd = path.resolve(base, contract.server.cwd ?? '.');
  const client = new StdioMcpClient(
    contract.server.command,
    contract.server.args,
    serverCwd,
    { ...process.env, ...contract.server.env },
    contract.server.timeout_seconds * 1000,
  );

  try {
    const initialized = await client.request('initialize', {
      protocolVersion: contract.server.protocol_version,
      capabilities: {},
      clientInfo: { name: 'claude-code-canary', version: CANARY_VERSION },
    });
    if (!isRecord(initialized)) throw new Error('MCP initialize returned a non-object result.');
    const protocolVersion = initialized.protocolVersion;
    if (typeof protocolVersion !== 'string' || !protocolVersion) throw new Error('MCP initialize result is missing protocolVersion.');
    const capabilities = isRecord(initialized.capabilities) ? normalizeJson(initialized.capabilities) as Record<string, unknown> : {};
    const serverInfo = isRecord(initialized.serverInfo) ? normalizeJson(initialized.serverInfo) as Record<string, unknown> : undefined;
    client.notify('notifications/initialized');

    const tools = valueAt(capabilities, ['tools']) === undefined
      ? []
      : (await collectPages(client, 'tools/list', 'tools')).map(normalizeTool).sort((a, b) => a.name.localeCompare(b.name));
    const prompts = valueAt(capabilities, ['prompts']) === undefined
      ? []
      : (await collectPages(client, 'prompts/list', 'prompts')).map(normalizePrompt).sort((a, b) => a.name.localeCompare(b.name));
    const resources = valueAt(capabilities, ['resources']) === undefined
      ? []
      : (await collectPages(client, 'resources/list', 'resources')).map(normalizeResource).sort((a, b) => a.uri.localeCompare(b.uri));
    let resourceTemplates: McpResourceTemplateSnapshot[] = [];
    if (valueAt(capabilities, ['resources']) !== undefined) {
      try {
        resourceTemplates = (await collectPages(client, 'resources/templates/list', 'resourceTemplates'))
          .map(normalizeResourceTemplate)
          .sort((a, b) => a.uriTemplate.localeCompare(b.uriTemplate));
      } catch (error) {
        if (!(error instanceof Error) || !/JSON-RPC error -32601/.test(error.message)) throw error;
      }
    }

    const withoutFingerprint: Omit<McpContractSnapshot, 'fingerprint'> = {
      schemaVersion: 1,
      contract: contract.name,
      capturedAt: new Date().toISOString(),
      requestedProtocolVersion: contract.server.protocol_version,
      protocolVersion,
      serverInfo,
      capabilities,
      tools,
      prompts,
      resources,
      resourceTemplates,
      observedNotifications: { ...client.notifications },
    };
    const fingerprint = createHash('sha256').update(stableJson(compatibilitySurface(withoutFingerprint))).digest('hex');
    return { ...withoutFingerprint, fingerprint };
  } finally {
    await client.close();
  }
}

function compareNames(label: string, actual: string[], expected: z.infer<typeof nameExpectations>, failures: string[]): void {
  const actualSet = new Set(actual);
  for (const required of expected.require) if (!actualSet.has(required)) failures.push(`${label}: required entry ${required} is missing.`);
  for (const denied of expected.deny) if (actualSet.has(denied)) failures.push(`${label}: denied entry ${denied} is exposed.`);
  if (expected.exact) {
    const expectedSet = new Set(expected.require);
    const unexpected = actual.filter((item) => !expectedSet.has(item));
    for (const item of unexpected) failures.push(`${label}: unexpected entry ${item} is exposed while exact=true.`);
  }
}

export function evaluateMcpExpectations(contract: McpContract, snapshot: McpContractSnapshot): McpExpectationResult {
  const failures: string[] = [];
  const expected = contract.expect;
  if (!expected) return { passed: true, failures };
  if (expected.tools) {
    compareNames('tools', snapshot.tools.map((tool) => tool.name), expected.tools, failures);
    const tools = new Map(snapshot.tools.map((tool) => [tool.name, tool]));
    for (const name of expected.tools.require_read_only) {
      const tool = tools.get(name);
      if (!tool) failures.push(`tools: read-only requirement references missing tool ${name}.`);
      else if (tool.annotations?.readOnlyHint !== true) failures.push(`tools: ${name} is not annotated readOnlyHint=true.`);
    }
    if (expected.tools.deny_destructive) {
      for (const tool of snapshot.tools) {
        if (tool.annotations?.destructiveHint === true) failures.push(`tools: destructive tool ${tool.name} is exposed.`);
      }
    }
  }
  if (expected.prompts) compareNames('prompts', snapshot.prompts.map((prompt) => prompt.name), expected.prompts, failures);
  if (expected.resources) compareNames('resources', snapshot.resources.map((resource) => resource.uri), expected.resources, failures);
  if (expected.resource_templates) compareNames('resource_templates', snapshot.resourceTemplates.map((template) => template.uriTemplate), expected.resource_templates, failures);
  if (expected.capabilities) {
    const checks: Array<[keyof typeof expected.capabilities, string[]]> = [
      ['tools_list_changed', ['tools', 'listChanged']],
      ['prompts_list_changed', ['prompts', 'listChanged']],
      ['resources_list_changed', ['resources', 'listChanged']],
      ['resources_subscribe', ['resources', 'subscribe']],
    ];
    for (const [key, pathParts] of checks) {
      const wanted = expected.capabilities[key];
      if (wanted === undefined) continue;
      const actual = valueAt(snapshot.capabilities, pathParts) === true;
      if (actual !== wanted) failures.push(`capabilities: ${pathParts.join('.')} expected ${String(wanted)} but was ${String(actual)}.`);
    }
  }
  return { passed: failures.length === 0, failures };
}

function byKey<T>(values: T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map((value) => [key(value), value]));
}

function compareCollections<T>(
  label: string,
  baseline: T[],
  candidate: T[],
  key: (value: T) => string,
  structural: (value: T) => unknown,
  breaking: string[],
  nonBreaking: string[],
): void {
  const before = byKey(baseline, key);
  const after = byKey(candidate, key);
  for (const [name, value] of before) {
    const current = after.get(name);
    if (!current) breaking.push(`${label}: removed ${name}.`);
    else if (stableJson(structural(value)) !== stableJson(structural(current))) breaking.push(`${label}: contract changed for ${name}.`);
  }
  for (const name of after.keys()) if (!before.has(name)) nonBreaking.push(`${label}: added ${name}.`);
}

function flattenBooleanCapabilities(value: unknown, prefix = ''): Map<string, boolean> {
  const output = new Map<string, boolean>();
  if (!isRecord(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'boolean') output.set(full, child);
    else if (isRecord(child)) for (const [nested, nestedValue] of flattenBooleanCapabilities(child, full)) output.set(nested, nestedValue);
  }
  return output;
}

export function compareMcpSnapshots(baseline: McpContractSnapshot, candidate: McpContractSnapshot): McpComparisonResult {
  const breakingChanges: string[] = [];
  const nonBreakingChanges: string[] = [];
  compareCollections('tools', baseline.tools, candidate.tools, (tool) => tool.name,
    (tool) => ({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations }), breakingChanges, nonBreakingChanges);
  compareCollections('prompts', baseline.prompts, candidate.prompts, (prompt) => prompt.name,
    (prompt) => ({ arguments: prompt.arguments }), breakingChanges, nonBreakingChanges);
  compareCollections('resources', baseline.resources, candidate.resources, (resource) => resource.uri,
    (resource) => ({ mimeType: resource.mimeType }), breakingChanges, nonBreakingChanges);
  compareCollections('resource_templates', baseline.resourceTemplates, candidate.resourceTemplates, (template) => template.uriTemplate,
    (template) => ({ mimeType: template.mimeType }), breakingChanges, nonBreakingChanges);

  const beforeCapabilities = flattenBooleanCapabilities(baseline.capabilities);
  const afterCapabilities = flattenBooleanCapabilities(candidate.capabilities);
  for (const [name, value] of beforeCapabilities) {
    const current = afterCapabilities.get(name);
    if (value === true && current !== true) breakingChanges.push(`capabilities: ${name} was removed or disabled.`);
  }
  for (const [name, value] of afterCapabilities) {
    if (value === true && beforeCapabilities.get(name) !== true) nonBreakingChanges.push(`capabilities: ${name} was added or enabled.`);
  }
  if (baseline.protocolVersion !== candidate.protocolVersion) {
    nonBreakingChanges.push(`protocol: negotiated version changed ${baseline.protocolVersion} -> ${candidate.protocolVersion}.`);
  }
  return { passed: breakingChanges.length === 0, breakingChanges, nonBreakingChanges };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'mcp';
}

export function defaultMcpSnapshotPath(contract: McpContract, cwd = process.cwd()): string {
  return path.join(path.resolve(cwd), '.canary', 'mcp', 'baselines', `${slug(contract.name)}.json`);
}

function validateSnapshot(value: unknown): McpContractSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('Unsupported MCP snapshot schema.');
  if (typeof value.contract !== 'string' || typeof value.protocolVersion !== 'string' || typeof value.requestedProtocolVersion !== 'string') {
    throw new Error('MCP snapshot metadata is invalid.');
  }
  if (!isRecord(value.capabilities) || !Array.isArray(value.tools) || !Array.isArray(value.prompts) || !Array.isArray(value.resources) || !Array.isArray(value.resourceTemplates)) {
    throw new Error('MCP snapshot surface is invalid.');
  }
  if (typeof value.fingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(value.fingerprint)) throw new Error('MCP snapshot fingerprint is invalid.');
  const snapshot = value as unknown as McpContractSnapshot;
  const expected = createHash('sha256').update(stableJson(compatibilitySurface(snapshot))).digest('hex');
  if (snapshot.fingerprint !== expected) throw new Error('MCP snapshot fingerprint does not match its compatibility surface.');
  return snapshot;
}

export async function loadMcpSnapshot(snapshotPath: string): Promise<McpContractSnapshot> {
  try {
    return validateSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')));
  } catch (error) {
    if (error instanceof Error && /MCP snapshot/.test(error.message)) throw error;
    throw new Error(`Could not load MCP snapshot ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

export async function writeMcpSnapshot(contractPath: string, options: McpSnapshotOptions = {}): Promise<{ snapshot: McpContractSnapshot; path: string }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absoluteContract = path.resolve(cwd, contractPath);
  const contract = await loadMcpContract(absoluteContract);
  const snapshot = await inspectMcpContract(contract, { cwd, contractPath: absoluteContract });
  const output = path.resolve(cwd, options.output ?? defaultMcpSnapshotPath(contract, cwd));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { snapshot, path: output };
}

export async function checkMcpContract(contractPath: string, options: McpCheckOptions = {}): Promise<McpCheckResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absoluteContract = path.resolve(cwd, contractPath);
  const contract = await loadMcpContract(absoluteContract);
  const snapshot = await inspectMcpContract(contract, { cwd, contractPath: absoluteContract });
  const expectations = evaluateMcpExpectations(contract, snapshot);
  const baselinePath = path.resolve(cwd, options.baseline ?? defaultMcpSnapshotPath(contract, cwd));
  let baseline: McpContractSnapshot | undefined;
  let comparison: McpComparisonResult | undefined;
  if (await pathExists(baselinePath)) {
    baseline = await loadMcpSnapshot(baselinePath);
    if (baseline.contract !== contract.name) throw new Error(`MCP baseline is for ${baseline.contract}, not ${contract.name}.`);
    comparison = compareMcpSnapshots(baseline, snapshot);
  } else if (options.requireBaseline || options.baseline) {
    throw new Error(`MCP baseline does not exist: ${baselinePath}`);
  }
  let snapshotPath: string | undefined;
  if (options.saveSnapshot) {
    snapshotPath = path.resolve(cwd, options.saveSnapshot);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }
  return {
    contract,
    snapshot,
    expectations,
    baseline,
    comparison,
    passed: expectations.passed && (comparison?.passed ?? true),
    snapshotPath,
  };
}

export async function compareMcpContracts(baselineContractPath: string, candidateContractPath: string, options: McpCompareOptions = {}): Promise<{
  baseline: McpContractSnapshot;
  candidate: McpContractSnapshot;
  comparison: McpComparisonResult;
  passed: boolean;
}> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const baselinePath = path.resolve(cwd, baselineContractPath);
  const candidatePath = path.resolve(cwd, candidateContractPath);
  const baselineContract = await loadMcpContract(baselinePath);
  const candidateContract = await loadMcpContract(candidatePath);
  const baseline = await inspectMcpContract(baselineContract, { cwd, contractPath: baselinePath });
  const candidate = await inspectMcpContract(candidateContract, { cwd, contractPath: candidatePath });
  const comparison = compareMcpSnapshots(baseline, candidate);
  return { baseline, candidate, comparison, passed: comparison.passed };
}

export function formatMcpCheckMarkdown(result: McpCheckResult): string {
  const lines = [
    '# Claude Code Canary — MCP Contract Report',
    '',
    `**Contract:** ${result.contract.name}`,
    `**Result:** ${result.passed ? 'PASS' : 'REGRESSION'}`,
    `**Protocol:** ${result.snapshot.protocolVersion}`,
    `**Fingerprint:** \`${result.snapshot.fingerprint.slice(0, 16)}…\``,
    '',
    '| Surface | Count |',
    '| --- | ---: |',
    `| Tools | ${result.snapshot.tools.length} |`,
    `| Prompts | ${result.snapshot.prompts.length} |`,
    `| Resources | ${result.snapshot.resources.length} |`,
    `| Resource templates | ${result.snapshot.resourceTemplates.length} |`,
  ];
  if (result.expectations.failures.length) {
    lines.push('', '## Expectation failures', '', ...result.expectations.failures.map((failure) => `- ${failure}`));
  }
  if (result.comparison) {
    lines.push('', '## Baseline comparison', '');
    if (result.comparison.breakingChanges.length) lines.push(...result.comparison.breakingChanges.map((change) => `- BREAKING: ${change}`));
    if (result.comparison.nonBreakingChanges.length) lines.push(...result.comparison.nonBreakingChanges.map((change) => `- INFO: ${change}`));
    if (!result.comparison.breakingChanges.length && !result.comparison.nonBreakingChanges.length) lines.push('- No contract changes.');
  }
  lines.push('', '## Observed list_changed notifications', '',
    `- tools: ${result.snapshot.observedNotifications.toolsListChanged}`,
    `- prompts: ${result.snapshot.observedNotifications.promptsListChanged}`,
    `- resources: ${result.snapshot.observedNotifications.resourcesListChanged}`,
  );
  return `${lines.join('\n')}\n`;
}

export function formatMcpComparisonMarkdown(result: { baseline: McpContractSnapshot; candidate: McpContractSnapshot; comparison: McpComparisonResult; passed: boolean }): string {
  const lines = [
    '# Claude Code Canary — MCP Contract Comparison',
    '',
    `**Result:** ${result.passed ? 'PASS' : 'REGRESSION'}`,
    `**Baseline:** ${result.baseline.contract} \`${result.baseline.fingerprint.slice(0, 12)}…\``,
    `**Candidate:** ${result.candidate.contract} \`${result.candidate.fingerprint.slice(0, 12)}…\``,
    '',
    '## Breaking changes',
    '',
    ...(result.comparison.breakingChanges.length ? result.comparison.breakingChanges.map((change) => `- ${change}`) : ['- None']),
    '',
    '## Non-breaking changes',
    '',
    ...(result.comparison.nonBreakingChanges.length ? result.comparison.nonBreakingChanges.map((change) => `- ${change}`) : ['- None']),
  ];
  return `${lines.join('\n')}\n`;
}
