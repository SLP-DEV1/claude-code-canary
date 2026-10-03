import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release and live E2E hardening', () => {
  it('passes the manual release tag through an environment variable before shell parsing', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('RELEASE_INPUT_TAG: ${{ inputs.tag }}');
    expect(workflow).toContain('tag="$RELEASE_INPUT_TAG"');
    expect(workflow).not.toContain("tag='${{ inputs.tag }}'");
  });

  it('does not interpolate provider-controlled step outputs directly into the summary shell script', async () => {
    const workflow = await readFile('.github/workflows/live-e2e.yml', 'utf8');

    expect(workflow).toContain("PRIMARY_PROVIDER: ${{ steps.provider.outputs['primary-provider'] || 'not completed' }}");
    expect(workflow).toContain("PROVIDER_USED: ${{ steps.provider.outputs.provider || 'not completed' }}");
    expect(workflow).toContain("MODEL_USED: ${{ steps.provider.outputs.model || 'not completed' }}");
    expect(workflow).toContain("FALLBACK_USED: ${{ steps.provider.outputs['fallback-used'] || 'false' }}");
    expect(workflow).not.toContain("echo \"- Primary provider: \\`${{");
    expect(workflow).not.toContain("echo \"- Provider used: \\`${{");
    expect(workflow).not.toContain("echo \"- Model: \\`${{");
  });

  it('keeps the core live scenario read-only while requiring evidence from a repository file', async () => {
    const driver = await readFile('scripts/live-e2e.mjs', 'utf8');

    expect(driver).toContain('LIVE_CANARY_SEED_7F2D91');
    expect(driver).toContain('Read seed.txt from the repository root');
    expect(driver).toContain('claude_output_contains');
    expect(driver).toContain('Do not modify, delete, or create any repository file.');
    expect(driver).not.toContain('Create a file named result.txt');
  });
});
