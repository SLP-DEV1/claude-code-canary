import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainSuiteSelection, loadSuite } from '../src/suite.js';

const cwd = process.cwd();

const monorepoSuitePath = path.join(cwd, 'examples/workspaces/monorepo.suite.yml');
const multiPluginSuitePath = path.join(cwd, 'examples/workspaces/multi-plugin.suite.yml');

function selectedPaths(selection: Awaited<ReturnType<typeof explainSuiteSelection>>): string[] {
  return selection.selected.map((item) => item.path);
}

describe('workspace examples', () => {
  it('loads the monorepo example and selects package plus shared plus always-run contracts', async () => {
    const suite = await loadSuite(monorepoSuitePath);
    const selection = await explainSuiteSelection(suite, {
      cwd,
      changedPaths: ['apps/web/src/App.tsx'],
    });

    expect(selection.discovered).toHaveLength(4);
    expect(selectedPaths(selection)).toEqual([
      'examples/workspaces/scenarios/monorepo-health.canary.yml',
      'examples/workspaces/scenarios/monorepo-shared.canary.yml',
      'examples/workspaces/scenarios/monorepo-web.canary.yml',
    ]);
  });

  it('keeps only the always-run monorepo health scenario for unrelated changes', async () => {
    const suite = await loadSuite(monorepoSuitePath);
    const selection = await explainSuiteSelection(suite, {
      cwd,
      changedPaths: ['docs/README.md'],
    });

    expect(selectedPaths(selection)).toEqual([
      'examples/workspaces/scenarios/monorepo-health.canary.yml',
    ]);
  });

  it('selects only the changed plugin for plugin implementation changes', async () => {
    const suite = await loadSuite(multiPluginSuitePath);
    const selection = await explainSuiteSelection(suite, {
      cwd,
      changedPaths: ['plugins/alpha/commands/review.md'],
    });

    expect(selection.discovered).toHaveLength(3);
    expect(selectedPaths(selection)).toEqual([
      'examples/workspaces/scenarios/plugin-alpha.canary.yml',
    ]);
  });

  it('adds the shared marketplace contract when a plugin manifest changes', async () => {
    const suite = await loadSuite(multiPluginSuitePath);
    const selection = await explainSuiteSelection(suite, {
      cwd,
      changedPaths: ['plugins/alpha/.claude-plugin/plugin.json'],
    });

    expect(selectedPaths(selection)).toEqual([
      'examples/workspaces/scenarios/plugin-alpha.canary.yml',
      'examples/workspaces/scenarios/plugin-marketplace.canary.yml',
    ]);
  });

  it('supports focused plugin tag selection', async () => {
    const suite = await loadSuite(multiPluginSuitePath);
    const selection = await explainSuiteSelection(suite, {
      cwd,
      tag: 'plugin-beta',
    });

    expect(selectedPaths(selection)).toEqual([
      'examples/workspaces/scenarios/plugin-beta.canary.yml',
    ]);
  });
});
