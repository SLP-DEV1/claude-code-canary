from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected patch anchor missing in {path}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/index.ts",
    "import { createReproBundle } from './repro.js';\nimport { formatComparison, formatRun } from './report.js';",
    "import { createReproBundle } from './repro.js';\nimport { evaluateComparisonRegressions } from './regressions.js';\nimport { formatComparison, formatRun } from './report.js';",
)

replace_once(
    "src/index.ts",
    """    const baseline = await runScenario(scenario, { executableOverride: baselineExecutable, artifactLabel: baselineLabel });
    const candidate = await runScenario(scenario, { executableOverride: candidateExecutable, artifactLabel: candidateLabel });
    console.log(options.json ? JSON.stringify({ baseline, candidate }, null, 2) : formatComparison(baseline, candidate));
    if (!candidate.passed) process.exitCode = 1;
""",
    """    const baseline = await runScenario(scenario, { executableOverride: baselineExecutable, artifactLabel: baselineLabel });
    const candidate = await runScenario(scenario, { executableOverride: candidateExecutable, artifactLabel: candidateLabel });
    const regressions = evaluateComparisonRegressions(scenario, baseline, candidate);
    const passed = candidate.passed && regressions.passed;
    console.log(options.json
      ? JSON.stringify({ baseline, candidate, regressions, passed }, null, 2)
      : formatComparison(baseline, candidate, regressions.failures));
    if (!passed) process.exitCode = 1;
""",
)

replace_once(
    "README.md",
    """Canary keeps historical native binaries in its own cache and never replaces your normal `claude` installation. Release manifests are checksum-verified; signed manifests are signature-verified where Anthropic publishes signatures.

### Find the first bad release
""",
    """Canary keeps historical native binaries in its own cache and never replaces your normal `claude` installation. Release manifests are checksum-verified; signed manifests are signature-verified where Anthropic publishes signatures.

`compare` can also fail on **relative regressions even when both releases still produce the correct result**: token growth, reported-cost growth, extra tool calls, new permission prompts/denials, or a changed hook sequence. See [Efficiency and lifecycle regressions](docs/REGRESSION_SEMANTICS.md).

### Find the first bad release
""",
)

replace_once(
    "README.md",
    """  file_contains:
    - path: src/auth/index.ts
      text: authenticate

limits:
  max_tool_calls: 100
  max_total_tokens: 200000
  max_cost_usd: 5
""",
    """  file_contains:
    - path: src/auth/index.ts
      text: authenticate
  permissions:
    max_prompts: 0
    max_denied: 0
  hooks:
    sequence:
      - PreToolUse
      - PostToolUse

limits:
  max_tool_calls: 100
  max_total_tokens: 200000
  max_cost_usd: 5

regressions:
  max_total_tokens_increase_pct: 25
  max_reported_cost_increase_pct: 20
  max_tool_calls_increase_pct: 25
  max_permission_prompts_increase: 0
  require_same_hook_sequence: true
""",
)

replace_once(
    "README.md",
    "| [Configuration experiments](docs/CONFIG_EXPERIMENTS.md) | A/B test layout and interpretation |",
    "| [Efficiency & lifecycle regressions](docs/REGRESSION_SEMANTICS.md) | Relative token/cost/tool regressions, permission prompts and ordered hooks |\n| [Configuration experiments](docs/CONFIG_EXPERIMENTS.md) | A/B test layout and interpretation |",
)

changelog = Path("CHANGELOG.md")
text = changelog.read_text(encoding="utf-8")
anchor = "## [Unreleased]\n"
addition = """## [Unreleased]

### Added

- add relative `compare` regression thresholds for total/input/output tokens, reported cost and tool calls
- capture `PermissionRequest` / `PermissionDenied` lifecycle semantics and allow scenarios to fail on unexpected permission prompts
- preserve ordered hook lifecycle traces and support ordered/exact hook assertions plus release-to-release hook-sequence stability checks
- automatically enable Claude Code hook-event streaming when permission or lifecycle assertions require it
"""
if anchor not in text:
    raise SystemExit("CHANGELOG Unreleased anchor missing")
if "relative `compare` regression thresholds" not in text:
    changelog.write_text(text.replace(anchor, addition, 1), encoding="utf-8")
