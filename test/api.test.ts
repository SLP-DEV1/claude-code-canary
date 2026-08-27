import { describe, expect, it } from 'vitest';
import * as api from '../src/api.js';

describe('v1 programmatic API', () => {
  it('exports the supported stable entry points', () => {
    for (const name of [
      'ScenarioSchema',
      'loadScenario',
      'parseScenario',
      'runScenario',
      'formatRun',
      'formatComparison',
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
    expect(api.CANARY_VERSION).toBe('1.0.0');
  });
});
