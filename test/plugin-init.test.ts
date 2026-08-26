import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScenario } from '../src/config.js';
import { discoverPlugin, generatePluginScenarios } from '../src/plugin-init.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'canary-plugin-init-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writePlugin(root: string): Promise<string> {
  const plugin = path.join(root, 'demo-plugin');
  await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
  await mkdir(path.join(plugin, 'commands'), { recursive: true });
  await mkdir(path.join(plugin, 'custom-agents'), { recursive: true });
  await mkdir(path.join(plugin, 'skills', 'repo-guide'), { recursive: true });
  await mkdir(path.join(plugin, 'hooks'), { recursive: true });
  await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo-plugin',
    agents: './custom-agents',
    hooks: { SessionStart: [{ hooks: [] }] },
    mcpServers: { demo: { command: 'node', args: ['server.js'] } },
  }), 'utf8');
  // Claude Code names plugin slash commands from the filename, not a name frontmatter field.
  await writeFile(path.join(plugin, 'commands', 'hello.md'), '---\nname: ignored-frontmatter-name\ndescription: Say hello\n---\nHello.\n', 'utf8');
  await writeFile(path.join(plugin, 'custom-agents', 'reader.md'), '---\nname: reader\ndescription: Read-only repository helper\n---\nInspect only.\n', 'utf8');
  await writeFile(path.join(plugin, 'skills', 'repo-guide', 'SKILL.md'), '---\nname: Repo Guide\ndescription: Use for repository orientation\n---\nGuide the user.\n', 'utf8');
  await writeFile(path.join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ Stop: [{ hooks: [] }] }), 'utf8');
  await writeFile(path.join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { local: { command: 'node', args: ['local.js'] } } }), 'utf8');
  return plugin;
}

describe('plugin smoke generator', () => {
  it('discovers default and manifest-defined plugin components', async () => {
    const root = await tempRoot();
    const plugin = await writePlugin(root);
    const discovery = await discoverPlugin(plugin);

    expect(discovery.pluginName).toBe('demo-plugin');
    expect(discovery.commands.map((entry) => entry.name)).toEqual(['hello']);
    expect(discovery.commands[0]?.description).toBe('Say hello');
    expect(discovery.agents.map((entry) => entry.name)).toEqual(['reader']);
    expect(discovery.skills.map((entry) => entry.name)).toEqual(['Repo Guide']);
    expect(discovery.hooks.map((entry) => entry.name)).toEqual(['SessionStart', 'Stop']);
    expect(discovery.mcpServers.map((entry) => entry.name)).toEqual(['demo', 'local']);
  });

  it('generates schema-valid load and component smoke scenarios', async () => {
    const root = await tempRoot();
    const plugin = await writePlugin(root);
    const project = path.join(root, 'project');
    await mkdir(project, { recursive: true });

    const generated = await generatePluginScenarios(plugin, { cwd: project });
    expect(generated.scenarios).toHaveLength(8);
    expect(generated.outputDir).toBe('.canary/plugins/demo-plugin');

    for (const entry of generated.scenarios) {
      const scenario = await loadScenario(path.join(project, entry.path));
      expect(scenario.name).toMatch(/^plugin-demo-plugin-/);
      expect(scenario.expect?.changed_files?.deny).toEqual(['**']);
    }

    const command = generated.scenarios.find((entry) => entry.kind === 'command');
    expect(command?.path).toContain('command-hello.canary.yml');
    const commandScenario = await loadScenario(path.join(project, command!.path));
    expect(commandScenario.prompt).toContain('/demo-plugin:hello');
    expect(commandScenario.prompt).not.toContain('ignored-frontmatter-name');

    const discovery = JSON.parse(await readFile(path.join(project, generated.discoveryPath), 'utf8')) as { pluginRoot: string };
    expect(discovery.pluginRoot).not.toBe(plugin);
    expect(discovery.pluginRoot).toContain('demo-plugin');
  });

  it('requires safe ./ manifest component paths', async () => {
    const root = await tempRoot();
    const plugin = path.join(root, 'bad-plugin');
    await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'bad-plugin',
      commands: '../outside',
    }), 'utf8');
    await expect(discoverPlugin(plugin)).rejects.toThrow(/must start with \.\//i);
  });

  it('refuses duplicate MCP server names from different plugin sources', async () => {
    const root = await tempRoot();
    const plugin = path.join(root, 'duplicate-mcp-plugin');
    await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: 'duplicate-mcp-plugin',
      mcpServers: { shared: { command: 'node', args: ['manifest.js'] } },
    }), 'utf8');
    await writeFile(path.join(plugin, '.mcp.json'), JSON.stringify({
      mcpServers: { shared: { command: 'node', args: ['default.js'] } },
    }), 'utf8');

    await expect(discoverPlugin(plugin)).rejects.toThrow(/duplicate MCP server name/i);
  });

  it('refuses plugin trees containing symlinks', async () => {
    const root = await tempRoot();
    const plugin = path.join(root, 'linked-plugin');
    await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true });
    await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'linked-plugin' }), 'utf8');
    const outside = path.join(root, 'outside.txt');
    await writeFile(outside, 'outside', 'utf8');
    await symlink(outside, path.join(plugin, 'outside-link'));
    await expect(discoverPlugin(plugin)).rejects.toThrow(/symlink/i);
  });

  it('only force-replaces output carrying the Canary marker', async () => {
    const root = await tempRoot();
    const plugin = await writePlugin(root);
    const project = path.join(root, 'project');
    const occupied = path.join(project, 'custom-output');
    await mkdir(occupied, { recursive: true });
    await writeFile(path.join(occupied, 'user.txt'), 'keep me', 'utf8');

    await expect(generatePluginScenarios(plugin, { cwd: project, output: 'custom-output', force: true })).rejects.toThrow(/refusing to replace/i);

    const first = await generatePluginScenarios(plugin, { cwd: project, output: 'generated' });
    expect(first.scenarios.length).toBeGreaterThan(1);
    const second = await generatePluginScenarios(plugin, { cwd: project, output: 'generated', force: true });
    expect(second.scenarios).toHaveLength(first.scenarios.length);
  });
});
