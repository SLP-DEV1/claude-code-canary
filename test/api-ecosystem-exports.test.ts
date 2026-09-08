import { describe, expect, it } from 'vitest';
import * as api from '../src/api.js';

describe('v2.2 ecosystem package exports', () => {
  it('exports signing, badge, pack discovery and registry exchange APIs from package root', () => {
    expect(api.signCompatibilityManifest).toBeTypeOf('function');
    expect(api.verifySignedCompatibilityManifest).toBeTypeOf('function');
    expect(api.publishCompatibilityBadge).toBeTypeOf('function');
    expect(api.buildScenarioPackDiscovery).toBeTypeOf('function');
    expect(api.buildScenarioPackCatalog).toBeTypeOf('function');
    expect(api.exportCompatibilityRegistry).toBeTypeOf('function');
    expect(api.importCompatibilityRegistries).toBeTypeOf('function');
  });
});
