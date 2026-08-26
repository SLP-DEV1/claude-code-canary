import { access, lstat, mkdir, opendir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PLUGIN_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MARKER_FILE = '.claude-canary-plugin-init';

export type PluginComponentKind = 'command' | 'agent' | 'skill' | 'hook' | 'mcp';

export interface PluginComponent {
  kind: PluginComponentKind;
  name: string;
  path: string;
  source: 'default' | 'manifest';
  description?: string;
}

export interface PluginDiscovery {
  schemaVersion: 1;
  pluginName: string;
  pluginRoot: string;
  manifestPath: string;
  commands: PluginComponent[];
  agents: PluginComponent[];
  skills: PluginComponent[];
  hooks: PluginComponent[];
  mcpServers: PluginComponent[];
  warnings: string[];
}

export interface GeneratedPluginScenario {
  kind: 'load' | PluginComponentKind;
  component?: string;
  path: string;
}

export interface PluginInitResult {
  pluginName: string;
  outputDir: string;
  discoveryPath: string;
  scenarios: GeneratedPluginScenario[];
  discovery: PluginDiscovery;
}

export interface PluginInitOptions {
  cwd?: string;
  output?: string;
  force?: boolean;
}

interface PluginManifest extends Record<string, unknown> {
  name?: unknown;
  commands?: unknown;
  agents?: unknown;
  hooks?: unknown;
  mcpServers?: unknown;
}

function normalize(value: string): string {
  return value.split(path.sep).join('/');
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'component';
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function assertNoSymlinks(root: string): Promise<void> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) throw new Error(`Plugin path must not be a symlink: ${root}`);
  if (!rootInfo.isDirectory()) throw new Error(`Plugin path must be a directory: ${root}`);

  async function walk(current: string): Promise<void> {
    const directory = await opendir(current);
    for await (const entry of directory) {
      const absolute = path.join(current, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`Plugin contains a symlink, which Canary refuses for isolated plugin tests: ${normalize(path.relative(root, absolute))}`);
      }
      if (info.isDirectory()) await walk(absolute);
    }
  }

  await walk(root);
}

function validateManifestPath(value: string, field: string): string {
  if (!value.startsWith('./')) throw new Error(`plugin.json ${field} path must start with ./; received ${JSON.stringify(value)}.`);
  if (value.includes('\\')) throw new Error(`plugin.json ${field} path must use forward slashes; received ${JSON.stringify(value)}.`);
  const segments = value.split('/');
  if (segments.includes('..')) throw new Error(`plugin.json ${field} path must not contain ..; received ${JSON.stringify(value)}.`);
  if (path.posix.isAbsolute(value)) throw new Error(`plugin.json ${field} path must be relative; received ${JSON.stringify(value)}.`);
  return value.slice(2);
}

function manifestPaths(value: unknown, field: 'commands' | 'agents'): string[] {
  if (value === undefined) return [];
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  if (!values || values.some((entry) => typeof entry !== 'string')) {
    throw new Error(`plugin.json ${field} must be a string or array of strings.`);
  }
  return values.map((entry) => validateManifestPath(entry as string, field));
}

function frontmatter(text: string, file: string): Record<string, unknown> {
  if (!text.startsWith('---')) return {};
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return {};
  const closing = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (closing < 0) throw new Error(`Unclosed YAML frontmatter in ${file}.`);
  const raw = lines.slice(1, closing + 1).join('\n');
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(`Invalid YAML frontmatter in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

async function markdownComponent(file: string, root: string, kind: 'command' | 'agent', source: 'default' | 'manifest'): Promise<PluginComponent> {
  const text = await readFile(file, 'utf8');
  const metadata = frontmatter(text, normalize(path.relative(root, file)));
  const metadataName = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : undefined;
  const metadataDescription = typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description.trim() : undefined;
  return {
    kind,
    name: metadataName ?? path.basename(file, path.extname(file)),
    path: normalize(path.relative(root, file)),
    source,
    description: metadataDescription,
  };
}

async function markdownFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return target.toLowerCase().endsWith('.md') ? [target] : [];
  if (!info.isDirectory()) return [];
  const found: string[] = [];
  const directory = await opendir(target);
  for await (const entry of directory) {
    const absolute = path.join(target, entry.name);
    if (entry.isDirectory()) found.push(...await markdownFiles(absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(absolute);
  }
  return found.sort();
}

async function collectMarkdownComponents(
  root: string,
  targets: Array<{ relative: string; source: 'default' | 'manifest' }>,
  kind: 'command' | 'agent',
): Promise<PluginComponent[]> {
  const byPath = new Map<string, PluginComponent>();
  for (const target of targets) {
    const absolute = path.join(root, target.relative);
    if (!await exists(absolute)) {
      if (target.source === 'manifest') throw new Error(`plugin.json ${kind}s path does not exist: ./${normalize(target.relative)}`);
      continue;
    }
    for (const file of await markdownFiles(absolute)) {
      const component = await markdownComponent(file, root, kind, target.source);
      byPath.set(component.path, component);
    }
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function collectSkills(root: string): Promise<PluginComponent[]> {
  const skillsRoot = path.join(root, 'skills');
  if (!await exists(skillsRoot)) return [];
  const found: PluginComponent[] = [];
  const directory = await opendir(skillsRoot);
  for await (const entry of directory) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!await exists(skillFile)) continue;
    const text = await readFile(skillFile, 'utf8');
    const metadata = frontmatter(text, normalize(path.relative(root, skillFile)));
    const name = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : entry.name;
    const description = typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description.trim() : undefined;
    found.push({ kind: 'skill', name, path: normalize(path.relative(root, skillFile)), source: 'default', description });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function parseJsonFile(file: string, root: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${normalize(path.relative(root, file))}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${normalize(path.relative(root, file))} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function hookComponents(config: Record<string, unknown>, sourcePath: string, source: 'default' | 'manifest'): PluginComponent[] {
  return Object.keys(config).sort().map((event) => ({ kind: 'hook', name: event, path: sourcePath, source }));
}

async function collectHooks(root: string, manifest: PluginManifest): Promise<PluginComponent[]> {
  const found = new Map<string, PluginComponent>();
  const defaultFile = path.join(root, 'hooks', 'hooks.json');
  if (await exists(defaultFile)) {
    for (const component of hookComponents(await parseJsonFile(defaultFile, root), 'hooks/hooks.json', 'default')) {
      found.set(`${component.path}:${component.name}`, component);
    }
  }

  if (typeof manifest.hooks === 'string') {
    const relative = validateManifestPath(manifest.hooks, 'hooks');
    const file = path.join(root, relative);
    if (!await exists(file)) throw new Error(`plugin.json hooks path does not exist: ./${normalize(relative)}`);
    for (const component of hookComponents(await parseJsonFile(file, root), normalize(relative), 'manifest')) {
      found.set(`${component.path}:${component.name}`, component);
    }
  } else if (manifest.hooks !== undefined) {
    if (typeof manifest.hooks !== 'object' || manifest.hooks === null || Array.isArray(manifest.hooks)) {
      throw new Error('plugin.json hooks must be a ./ path or inline object.');
    }
    for (const component of hookComponents(manifest.hooks as Record<string, unknown>, '.claude-plugin/plugin.json#hooks', 'manifest')) {
      found.set(`${component.path}:${component.name}`, component);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mcpServerMap(config: Record<string, unknown>): Record<string, unknown> {
  const nested = config.mcpServers;
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return config;
}

function mcpComponents(config: Record<string, unknown>, sourcePath: string, source: 'default' | 'manifest'): PluginComponent[] {
  return Object.keys(mcpServerMap(config)).sort().map((name) => ({ kind: 'mcp', name, path: sourcePath, source }));
}

async function collectMcp(root: string, manifest: PluginManifest): Promise<PluginComponent[]> {
  const found = new Map<string, PluginComponent>();
  const defaultFile = path.join(root, '.mcp.json');
  if (await exists(defaultFile)) {
    for (const component of mcpComponents(await parseJsonFile(defaultFile, root), '.mcp.json', 'default')) {
      found.set(component.name, component);
    }
  }

  if (typeof manifest.mcpServers === 'string') {
    const relative = validateManifestPath(manifest.mcpServers, 'mcpServers');
    const file = path.join(root, relative);
    if (!await exists(file)) throw new Error(`plugin.json mcpServers path does not exist: ./${normalize(relative)}`);
    for (const component of mcpComponents(await parseJsonFile(file, root), normalize(relative), 'manifest')) found.set(component.name, component);
  } else if (manifest.mcpServers !== undefined) {
    if (typeof manifest.mcpServers !== 'object' || manifest.mcpServers === null || Array.isArray(manifest.mcpServers)) {
      throw new Error('plugin.json mcpServers must be a ./ path or inline object.');
    }
    for (const component of mcpComponents(manifest.mcpServers as Record<string, unknown>, '.claude-plugin/plugin.json#mcpServers', 'manifest')) {
      found.set(component.name, component);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function duplicateNameWarnings(components: PluginComponent[], label: string): string[] {
  const counts = new Map<string, number>();
  for (const component of components) counts.set(component.name, (counts.get(component.name) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => `Duplicate ${label} name discovered: ${name}`);
}

export async function discoverPlugin(pluginPath: string): Promise<PluginDiscovery> {
  const root = path.resolve(pluginPath);
  await assertNoSymlinks(root);
  const manifestFile = path.join(root, '.claude-plugin', 'plugin.json');
  if (!await exists(manifestFile)) throw new Error(`Claude Code plugin manifest not found: ${manifestFile}`);
  const manifest = await parseJsonFile(manifestFile, root) as PluginManifest;
  if (typeof manifest.name !== 'string' || !PLUGIN_NAME_RE.test(manifest.name)) {
    throw new Error('plugin.json name is required and must be kebab-case (lowercase letters, numbers and hyphens).');
  }

  const commandTargets = [{ relative: 'commands', source: 'default' as const }, ...manifestPaths(manifest.commands, 'commands').map((relative) => ({ relative, source: 'manifest' as const }))];
  const agentTargets = [{ relative: 'agents', source: 'default' as const }, ...manifestPaths(manifest.agents, 'agents').map((relative) => ({ relative, source: 'manifest' as const }))];
  const commands = await collectMarkdownComponents(root, commandTargets, 'command');
  const agents = await collectMarkdownComponents(root, agentTargets, 'agent');
  const skills = await collectSkills(root);
  const hooks = await collectHooks(root, manifest);
  const mcpServers = await collectMcp(root, manifest);
  const warnings = [
    ...duplicateNameWarnings(commands, 'command'),
    ...duplicateNameWarnings(agents, 'agent'),
    ...duplicateNameWarnings(skills, 'skill'),
  ];

  if (commands.length + agents.length + skills.length + hooks.length + mcpServers.length === 0) {
    warnings.push('No commands, agents, skills, hooks or MCP servers were discovered.');
  }

  return {
    schemaVersion: 1,
    pluginName: manifest.name,
    pluginRoot: root,
    manifestPath: '.claude-plugin/plugin.json',
    commands,
    agents,
    skills,
    hooks,
    mcpServers,
    warnings,
  };
}

function baseScenario(name: string, prompt: string, includeHookEvents = false): Record<string, unknown> {
  return {
    version: 1,
    name,
    prompt,
    claude: {
      executable: 'claude',
      args: [],
      permission_mode: 'dontAsk',
      include_hook_events: includeHookEvents,
      max_turns: 8,
      timeout_seconds: 300,
      env: {},
    },
    expect: {
      changed_files: { allow: [], require: [], deny: ['**'] },
      files_exist: [],
      files_absent: [],
      file_contains: [],
    },
    limits: { max_tool_calls: 40, max_total_tokens: 80000 },
  };
}

function scenarioForComponent(plugin: string, component: PluginComponent): Record<string, unknown> {
  const id = safeSlug(component.name);
  if (component.kind === 'command') {
    return baseScenario(
      `plugin-${plugin}-command-${id}`,
      `Smoke-test the Claude Code plugin ${plugin}. Invoke the plugin slash command /${plugin}:${component.name} with a harmless read-only help or inspection request. Do not modify repository files. If the command is unavailable or errors, stop and report the failure.`,
    );
  }
  if (component.kind === 'skill') {
    const hint = component.description ? ` The skill description is: ${component.description}` : '';
    return baseScenario(
      `plugin-${plugin}-skill-${id}`,
      `Smoke-test the Claude Code plugin ${plugin}. Use the ${component.name} skill for a small read-only explanation or repository-inspection task that clearly matches the skill.${hint} Do not modify repository files. If the skill cannot be activated, report the failure.`,
    );
  }
  if (component.kind === 'agent') {
    const hint = component.description ? ` Agent description: ${component.description}` : '';
    return baseScenario(
      `plugin-${plugin}-agent-${id}`,
      `Smoke-test the Claude Code plugin ${plugin}. Delegate a small read-only repository inspection to the ${component.name} agent.${hint} Do not modify repository files. If the agent is unavailable or fails, report the failure.`,
    );
  }
  if (component.kind === 'hook') {
    return baseScenario(
      `plugin-${plugin}-hook-${id}`,
      `Smoke-test the Claude Code plugin ${plugin} and exercise a harmless read-only session so the ${component.name} hook can load or fire when applicable. Do not modify repository files. Report any hook loading or execution error.`,
      true,
    );
  }
  return baseScenario(
    `plugin-${plugin}-mcp-${id}`,
    `Smoke-test the Claude Code plugin ${plugin}. Confirm that the MCP server ${component.name} connects and, if it exposes a clearly read-only discovery/list/status tool, call one harmless tool. Do not perform mutations and do not modify repository files. Report connection, startup or tool-discovery errors.`,
  );
}

function scenarioFile(kind: string, name?: string): string {
  return `${kind}${name ? `-${safeSlug(name)}` : ''}.canary.yml`;
}

async function prepareOutputDir(outputDir: string, force: boolean): Promise<void> {
  if (!await exists(outputDir)) {
    await mkdir(outputDir, { recursive: true });
    return;
  }
  if (!force) throw new Error(`Output directory already exists: ${outputDir}. Use --force to replace a previous plugin-init output.`);
  const marker = path.join(outputDir, MARKER_FILE);
  if (!await exists(marker)) {
    throw new Error(`Refusing to replace ${outputDir}: it does not contain Canary's ${MARKER_FILE} marker.`);
  }
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
}

export async function generatePluginScenarios(pluginPath: string, options: PluginInitOptions = {}): Promise<PluginInitResult> {
  const discovery = await discoverPlugin(pluginPath);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const outputDir = path.resolve(cwd, options.output ?? path.join('.canary', 'plugins', discovery.pluginName));
  await prepareOutputDir(outputDir, options.force ?? false);
  await writeFile(path.join(outputDir, MARKER_FILE), 'Generated by claude-canary plugin-init.\n', 'utf8');

  const portableDiscovery = { ...discovery, pluginRoot: normalize(path.relative(cwd, discovery.pluginRoot) || '.') };
  const discoveryPath = path.join(outputDir, 'discovery.json');
  await writeFile(discoveryPath, `${JSON.stringify(portableDiscovery, null, 2)}\n`, 'utf8');

  const scenarios: GeneratedPluginScenario[] = [];
  const loadPath = path.join(outputDir, scenarioFile('load'));
  await writeFile(loadPath, YAML.stringify(baseScenario(
    `plugin-${discovery.pluginName}-load`,
    `Smoke-test loading the Claude Code plugin ${discovery.pluginName}. Confirm the plugin loads without startup errors and summarize the available plugin components. Do not modify repository files.`,
    discovery.hooks.length > 0,
  )), 'utf8');
  scenarios.push({ kind: 'load', path: normalize(path.relative(cwd, loadPath)) });

  const groups: Array<[PluginComponentKind, PluginComponent[]]> = [
    ['command', discovery.commands],
    ['agent', discovery.agents],
    ['skill', discovery.skills],
    ['hook', discovery.hooks],
    ['mcp', discovery.mcpServers],
  ];
  for (const [kind, components] of groups) {
    for (const component of components) {
      const file = path.join(outputDir, scenarioFile(kind, component.name));
      await writeFile(file, YAML.stringify(scenarioForComponent(discovery.pluginName, component)), 'utf8');
      scenarios.push({ kind, component: component.name, path: normalize(path.relative(cwd, file)) });
    }
  }

  const readme = `# ${discovery.pluginName} Canary smoke suite\n\n` +
    `Generated by \`claude-canary plugin-init\`. Review prompts before relying on them as release gates.\n\n` +
    `Run one scenario against recent Claude Code releases:\n\n` +
    `\`\`\`bash\nclaude-canary plugin-matrix ${normalize(path.relative(cwd, loadPath))} --plugin ${normalize(path.relative(cwd, discovery.pluginRoot) || '.')} --last 10\n\`\`\`\n\n` +
    `Generated scenarios: **${scenarios.length}**\n\n` +
    scenarios.map((scenario) => `- \`${scenario.path}\`${scenario.component ? ` — ${scenario.kind}: ${scenario.component}` : ' — plugin load'}`).join('\n') + '\n';
  await writeFile(path.join(outputDir, 'README.md'), readme, 'utf8');

  return {
    pluginName: discovery.pluginName,
    outputDir: normalize(path.relative(cwd, outputDir)),
    discoveryPath: normalize(path.relative(cwd, discoveryPath)),
    scenarios,
    discovery: portableDiscovery,
  };
}
