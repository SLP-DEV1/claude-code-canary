import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type WorkflowStep = {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
};

type Workflow = {
  on?: {
    schedule?: Array<{ cron?: string }>;
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<string, {
    'runs-on'?: string;
    'timeout-minutes'?: number;
    steps?: WorkflowStep[];
  }>;
};

async function loadWorkflow(): Promise<Workflow> {
  const source = await readFile(new URL('../examples/github-actions/scheduled-watch.yml', import.meta.url), 'utf8');
  return parse(source) as Workflow;
}

describe('scheduled GitHub Actions watch example', () => {
  it('is a scheduled, manually runnable, serialized watch workflow', async () => {
    const workflow = await loadWorkflow();
    expect(workflow.on?.schedule?.[0]?.cron).toMatch(/^\d+ \*\/\d+ \* \* \*$/);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: 'claude-canary-release-watch',
      'cancel-in-progress': false,
    });
    expect(workflow.jobs?.watch?.['runs-on']).toBe('ubuntu-latest');
    expect(workflow.jobs?.watch?.['timeout-minutes']).toBeGreaterThanOrEqual(30);
  });

  it('restores state, requires an explicit first baseline and runs watch through the v2 Action', async () => {
    const steps = (await loadWorkflow()).jobs?.watch?.steps ?? [];
    const restore = steps.find((step) => step.name === 'Restore Canary watch state');
    const baseline = steps.find((step) => step.name === 'Require an explicit known-good baseline on first run');
    const canary = steps.find((step) => step.id === 'canary');

    expect(restore?.uses).toMatch(/^actions\/cache\/restore@[0-9a-f]{40}$/);
    expect(restore?.with?.path).toBe('.canary/watch-state.json');
    expect(restore?.with?.key).toContain('${{ github.run_id }}');
    expect(restore?.with?.['restore-keys']).toContain('claude-canary-watch-${{ runner.os }}-');

    expect(baseline?.if).toContain("hashFiles('.canary/watch-state.json') == ''");

    expect(canary?.uses).toBe('SLP-DEV1/claude-code-canary@v2');
    expect(canary?.['continue-on-error']).toBe(true);
    expect(canary?.with).toMatchObject({
      mode: 'watch',
      suite: '.canary/release.suite.yml',
      'watch-state': '.canary/watch-state.json',
      'watch-good': '${{ vars.CLAUDE_CANARY_KNOWN_GOOD }}',
      'upload-results': 'true',
    });
  });

  it('persists only trustworthy watch progress and then propagates Canary exit codes', async () => {
    const steps = (await loadWorkflow()).jobs?.watch?.steps ?? [];
    const save = steps.find((step) => step.name === 'Save successful or regression watch state');
    const propagate = steps.find((step) => step.name === 'Propagate Canary result');

    expect(save?.uses).toMatch(/^actions\/cache\/save@[0-9a-f]{40}$/);
    expect(save?.if).toContain("steps.canary.outputs.exit-code == '0'");
    expect(save?.if).toContain("steps.canary.outputs.exit-code == '2'");
    expect(save?.if).not.toContain("steps.canary.outputs.exit-code == '3'");
    expect(save?.if).not.toContain("steps.canary.outputs.exit-code == '4'");
    expect(save?.with?.path).toBe('.canary/watch-state.json');

    expect(propagate?.if).toContain("steps.canary.outputs.exit-code != '0'");
  });

  it('pins third-party infrastructure actions to immutable SHAs', async () => {
    const steps = (await loadWorkflow()).jobs?.watch?.steps ?? [];
    const thirdParty = steps
      .map((step) => step.uses)
      .filter((value): value is string => Boolean(value) && !value!.startsWith('SLP-DEV1/'));

    expect(thirdParty.length).toBeGreaterThanOrEqual(3);
    expect(thirdParty.every((value) => /@[0-9a-f]{40}$/.test(value))).toBe(true);
  });

  it('documents bootstrapping, retry-safe infrastructure handling and check-only discovery', async () => {
    const docs = await readFile(new URL('../docs/SCHEDULED_WATCH.md', import.meta.url), 'utf8');
    expect(docs).toContain('CLAUDE_CANARY_KNOWN_GOOD');
    expect(docs).toContain('Exit codes and state persistence');
    expect(docs).toContain('infrastructure failure');
    expect(docs).toContain('check-only');
    expect(docs).toContain('examples/github-actions/scheduled-watch.yml');
  });
});
