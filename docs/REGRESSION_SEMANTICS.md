# Efficiency and lifecycle regressions

A Claude Code release can still produce the correct final file while becoming materially more expensive, asking for new permissions, or changing hook ordering. Canary can treat those behavioral changes as regressions rather than relying only on final-output assertions.

## Relative efficiency thresholds

Absolute `limits` still apply to a single run. The separate `regressions` block applies only when Canary has both a baseline and a candidate, currently through `claude-canary compare`.

```yaml
regressions:
  max_total_tokens_increase_pct: 25
  max_input_tokens_increase_pct: 25
  max_output_tokens_increase_pct: 30
  max_reported_cost_increase_pct: 20
  max_tool_calls_increase_pct: 25
```

A candidate that produces the right result can therefore fail the comparison if, for example, total token usage rises by 40% against the baseline.

Percentage thresholds are directional: an equal or lower candidate value is not a regression. Growth from a zero baseline to a non-zero candidate is treated as a regression because there is no finite percentage increase to compare against the configured ceiling.

`max_reported_cost_increase_pct` is fail-closed. If either run does not report `total_cost_usd`, Canary refuses to call the configured cost comparison successful. As elsewhere in Canary, reported cost is upstream accounting metadata; proxies and local-model gateways may report estimated or synthetic values.

## Permission semantics

Claude Code emits a `PermissionRequest` lifecycle event when a tool call needs a permission decision. Canary records those events and can assert that a task stays non-interactive:

```yaml
expect:
  permissions:
    max_prompts: 0
    max_denied: 0
    deny_prompted_tools:
      - Read
      - Grep
      - mcp__safe_reader__*
```

`deny_prompted_tools` uses glob matching against the tool name. This is useful for tools that your CI contract expects to remain auto-allowed. A final output can be correct and the run can still fail if one of those tools unexpectedly starts prompting.

For release-to-release checks, you can allow a bounded increase rather than hard-coding an absolute count:

```yaml
regressions:
  max_permission_prompts_increase: 0
  max_permission_denied_increase: 0
```

With both values at zero, the candidate may not introduce any additional permission prompts or denials relative to the baseline.

## Ordered hook traces

Canary preserves the lifecycle order emitted by Claude Code instead of reducing hooks to an unordered set. A single run can require an ordered subsequence:

```yaml
expect:
  hooks:
    sequence:
      - PreToolUse
      - PostToolUse
```

By default other lifecycle events may appear between configured entries. To require the exact observed sequence:

```yaml
expect:
  hooks:
    sequence:
      - PreToolUse
      - PostToolUse
    deny_unexpected: true
```

For a release comparison, the strongest compatibility gate is:

```yaml
regressions:
  require_same_hook_sequence: true
```

That fails when the candidate lifecycle trace differs from the baseline, including insertion, removal, or reordering of events.

## Lifecycle capture is automatic

You do not need to remember `claude.include_hook_events: true` when a permission/hook assertion or lifecycle regression is configured. Canary automatically invokes Claude Code with `--include-hook-events` for scenarios that need those signals.

You can still set `claude.include_hook_events: true` explicitly when you only want the lifecycle data recorded in run artifacts without asserting on it.

## Complete example

```yaml
version: 1
name: stable-read-workflow
prompt: |
  Inspect src/config.ts and explain the current defaults.

claude:
  permission_mode: default

expect:
  permissions:
    max_prompts: 0
    max_denied: 0
    deny_prompted_tools:
      - Read
      - Grep
  hooks:
    sequence:
      - PreToolUse
      - PostToolUse

limits:
  max_total_tokens: 200000

regressions:
  max_total_tokens_increase_pct: 25
  max_input_tokens_increase_pct: 25
  max_output_tokens_increase_pct: 30
  max_reported_cost_increase_pct: 20
  max_tool_calls_increase_pct: 25
  max_permission_prompts_increase: 0
  max_permission_denied_increase: 0
  require_same_hook_sequence: true
```

Then compare two releases:

```bash
claude-canary compare .canary/stable-read.canary.yml \
  --from 2.1.247 \
  --to latest
```

Both releases may pass their standalone file/output assertions while the comparison itself fails because a configured efficiency or lifecycle threshold regressed.
