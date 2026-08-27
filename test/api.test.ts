import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as api from '../src/api.js';

describe('v1 programmatic API', () => {
  it('exports the supported stable entry points', async () => {
    for (const name of [
      'ScenarioSchema',
      'loadScenario',
      'parseScenario',
      'runScenario',
      'runDoctorReport',
      'detectProviderConfiguration',
      'AgentTeamScenarioSchema',
      'runAgentTeam',
      'compareAgentTeamResults',
      'formatRun',
      'formatComparison',
      'evaluateComparisonRegressions',
      'bisectCommands',
      'bisectReleases',
      'runExperiment',
      'discoverPlugin',
      'generatePluginScenarios',
      'runPluginMatrix',
      'runPluginSuite',
      'createReproBundle',
      'installClaudeVersion',
      'resolveClaudeVersion',
      'CANARY_VERSION',
    ]) {
      expect(api).toHaveProperty(name);
    }

    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(api.CANARY_VERSION).toBe(pkg.version);
  });
});
