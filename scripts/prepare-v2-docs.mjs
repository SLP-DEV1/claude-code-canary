#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

async function transform(file, fn) {
  const source = await readFile(file, 'utf8');
  const next = fn(source);
  if (next === source) throw new Error(`${file}: migration produced no changes.`);
  await writeFile(file, next, 'utf8');
}

function replaceExact(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing expected docs anchor: ${label}`);
  return source.replace(from, to);
}

await transform('README.md', (input) => {
  let source = input;
  source = replaceExact(
    source,
    'Canary runs the same scenario from the same Git commit in disposable worktrees, captures tool/token/reported-cost/duration metrics, checks deterministic assertions, compares releases, bisects regressions and builds full plugin compatibility matrices.\n\n## Start in 30 seconds',
    `Canary runs the same scenario from the same Git commit in disposable worktrees, captures tool/token/reported-cost/duration metrics, checks deterministic assertions, compares releases, bisects regressions and builds full plugin compatibility matrices.\n\n## What v2 adds\n\nCanary v2 turns those individual checks into a compatibility platform:\n\n- first-class scenario suites with tags, affected-path selection, concurrency, deterministic sharding and run budgets;\n- scheduled release watch with known-good state, regression detection and automatic first-bad-release bisection;\n- deterministic failure fingerprints and flakiness analysis so noisy scenarios are not confused with upstream regressions;\n- portable HTML, JUnit and SARIF reporting plus local historical trends;\n- compatibility manifests, \`canary.lock\`, open registry aggregation, evidence-backed badges and inspectable scenario packs;\n- permission-policy/trust regression coverage, isolated MCP fixtures, gateway matrices and signed/checksummed attestations;\n- versioned public schemas plus compatibility query/explain/graph APIs for build tools and multi-project workspaces.\n\nAll existing v1 workflows remain available through the v2 CLI.\n\n## Start in 30 seconds`,
    'README v2 introduction',
  );
  source = replaceExact(
    source,
    'Already using GitHub Actions? Add Canary as a CI step and keep the stable `@v1` tag:',
    'Already using GitHub Actions? Add Canary as a CI step and use the stable `@v2` major channel:',
    'README Action channel sentence',
  );
  source = source.replaceAll('SLP-DEV1/claude-code-canary@v1', 'SLP-DEV1/claude-code-canary@v2');
  source = replaceExact(
    source,
    '| Detect MCP schema/capability drift | `mcp-check` |\n| Check host/plugin/MCP readiness without exposing secrets | `doctor` |',
    '| Detect MCP schema/capability drift | `mcp-check` |\n| Run a deterministic scenario suite | `suite` |\n| Guard against newly published Claude Code releases | `watch` |\n| Measure scenario stability/noise | `flake` |\n| Publish/query portable compatibility evidence | `compat` / `lock` |\n| Generate interoperable local/CI reports | `report` / `trend` |\n| Check host/plugin/MCP readiness without exposing secrets | `doctor` |',
    'README workflow table',
  );
  source = replaceExact(
    source,
    'The v1 Action supports `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix` and `plugin-suite` through one Marketplace-ready `action.yml`.',
    'The v2 Action supports `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, `plugin-suite`, `suite` and `watch` through one Marketplace-ready `action.yml`.',
    'README Action modes',
  );
  return source;
});

await transform('docs/GITHUB_ACTION.md', (input) => {
  let source = input;
  source = replaceExact(
    source,
    'Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, MCP contract checks, committed-baseline checks and plugin compatibility suites.',
    'Claude Canary exposes one composite Action for deterministic release comparisons, pull-request regression gates, MCP contract checks, committed-baseline checks, plugin compatibility suites, first-class scenario suites and release watching.',
    'Action intro',
  );
  source = replaceExact(
    source,
    '- `plugin-suite`\n\nThe Action streams',
    '- `plugin-suite`\n- `suite`\n- `watch`\n\nThe Action streams',
    'Action supported modes',
  );
  source = source.replaceAll('SLP-DEV1/claude-code-canary@v1', 'SLP-DEV1/claude-code-canary@v2');
  source = replaceExact(
    source,
    'For the current exact immutable v1 patch release use `@v1.1.0` instead of the moving `@v1` compatibility tag. New modes documented under `[Unreleased]` are available from `main` until the next tagged release.\n\n## Compare two Claude Code releases',
    `For the immutable v2 launch release use \`@v2.0.0\` instead of the moving \`@v2\` compatibility tag. The v1 major channel remains on the v1.x line.\n\n## Run a first-class scenario suite\n\n\`\`\`yaml\n- uses: SLP-DEV1/claude-code-canary@v2\n  with:\n    mode: suite\n    suite: .canary/release.suite.yml\n\`\`\`\n\nSuites provide deterministic selection, bounded concurrency, sharding, run budgets, failure fingerprints and combined result artifacts.\n\n## Watch new Claude Code releases\n\n\`\`\`yaml\n- uses: SLP-DEV1/claude-code-canary@v2\n  with:\n    mode: watch\n    suite: .canary/release.suite.yml\n\`\`\`\n\nRun this mode from a trusted scheduled workflow. Canary stores small non-secret watch state, tests newly observed releases and can identify the first bad release when a regression appears.\n\n## Compare two Claude Code releases`,
    'Action v2 exact tag and new modes',
  );
  source = replaceExact(
    source,
    '| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, or `plugin-suite` |',
    '| `mode` | `compare` | all | `compare`, `run`, `pr-check`, `baseline-check`, `mcp-check`, `plugin-matrix`, `plugin-suite`, `suite`, or `watch` |',
    'Action input mode row',
  );
  source = replaceExact(
    source,
    '| `suite` | auto | plugin-suite | Generated Canary plugin-suite directory |',
    '| `suite` | mode-specific | plugin-suite/suite/watch | Generated plugin-suite directory or first-class scenario-suite YAML |',
    'Action suite input row',
  );
  source = source.replace('`pr-check`, `baseline-check`, `plugin-matrix` and `plugin-suite` create report artifacts.', '`pr-check`, `baseline-check`, `plugin-matrix`, `plugin-suite`, `suite` and `watch` create report artifacts.');
  source = source.replace('node <action>/dist/index.js <args...>', 'node <action>/dist/v2-cli.js <args...>');
  return source;
});

await transform('CHANGELOG.md', (input) => {
  const heading = '## [Unreleased]\n';
  if (!input.includes(heading)) throw new Error('CHANGELOG: missing Unreleased heading.');
  if (input.includes('## [2.0.0]')) throw new Error('CHANGELOG already contains 2.0.0.');
  const entry = `## [Unreleased]\n\n## [2.0.0] - 2026-08-28\n\n### Added\n\n- Add first-class deterministic scenario suites with tags, affected-path selection, bounded concurrency, deterministic sharding, fail-fast behavior, run budgets, explainable skips and compatibility-safe result reuse.\n- Add release watch state that detects newly published Claude Code versions, executes suites and automatically bisects unseen release ranges when the newest release regresses.\n- Add deterministic failure fingerprints/clustering and scenario/suite flakiness analysis with stability policies.\n- Add portable static HTML, JUnit XML and SARIF reports, local trend aggregation and explicit baseline proposals that never silently overwrite reviewed baselines.\n- Add privacy-minimized compatibility manifests, \`canary.lock\`, open registry aggregation, evidence-backed badges and inspectable scenario packs.\n- Add permission-policy coverage, hook/monitor trust regression checks, isolated MCP fixture packs, gateway/provider matrices and SHA-256/optional Ed25519 evidence attestations.\n- Add versioned public schemas for suite/watch/fingerprint/manifest/lock/registry/attestation results and a compatibility query/explain/graph API for multi-project aggregation.\n- Add \`suite\` and \`watch\` GitHub Action modes and the v2 CLI entry point while retaining existing v1-era commands.\n\n### Changed\n\n- Promote the package and public CLI contract to v2.0.0.\n- Keep Action major channels independent: v1 remains on the v1.x line while v2 releases move only \`v2\`.\n- Synchronize package-lock CLI bin metadata as part of release-version preparation.\n- Extend scenario/run metrics additively with selection metadata, stability/policy configuration and privacy-safe tool-name coverage.\n\n### Release integrity\n\n- A v2 release candidate on \`main\` triggers a full Live Claude E2E run on the exact candidate commit.\n- Only a successful \`Live Claude E2E (full)\` run can promote the candidate to its immutable tag and dispatch the hardened npm/GitHub release workflow.\n- npm publication continues to use Trusted Publishing/OIDC provenance and exact tag/package-version validation.\n`;
  return input.replace(heading, entry);
});

console.log('Prepared v2 README, Action docs and changelog.');
