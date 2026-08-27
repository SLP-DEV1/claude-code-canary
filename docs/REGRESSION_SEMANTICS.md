# Efficiency and lifecycle regressions

A Claude Code release can still produce the correct final file while becoming materially more expensive, asking for new permissions, or changing hook behavior. Canary can treat those behavioral changes as regressions rather than relying only on final-output assertions.

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

## Permission semantics in headless mode

Plain `claude -p` does not expose interactive permission dialogs, and Claude Code documents that `PermissionRequest` hooks do not fire for ordinary non-interactive `-p` permission decisions. Canary therefore does **not** infer prompts from hook text or final output.

When a permission-prompt assertion or comparison is configured, Canary loads an ephemeral local plugin and supplies its MCP tool through `--permission-prompt-tool`. Claude Code invokes that tool only when the headless run needs a permission decision. The probe records the requested **tool name only**, returns the original tool input unchanged, and allows execution to continue so Canary can evaluate the final task and the permission regression independently. Raw tool arguments are not persisted in the Canary result.

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

`deny_prompted_tools` uses glob matching against the tool name. This catches the important CI regression where a tool that was previously auto-allowed starts requiring a permission decision even though the final task still succeeds.

If a scenario already supplies its own `--permission-prompt-tool`, Canary fails closed when permission instrumentation is requested. Replacing or chaining an application-owned approval tool would change the permission policy being tested, so Canary refuses to guess.

`max_denied` measures Claude Code `PermissionDenied` lifecycle events. Claude Code currently defines that event for denials by the **auto-mode classifier**; it is not a generic counter for every possible static deny rule.

For release-to-release checks, you can allow a bounded increase rather than hard-coding an absolute count:

```yaml
regressions:
  max_permission_prompts_increase: 0
  max_permission_denied_increase: 0
```

With both values at zero, the candidate may not introduce additional permission prompts or observed auto-mode denials relative to the baseline.

## Ordered hook traces

For hook assertions, Canary enables Claude Code's `--include-hook-events` stream and records real `system / hook_started` messages using their `hook_event` field. It does not confuse these stream lifecycle messages with the separate `hook_event_name` field that command hooks receive on stdin.

A single run can require an ordered subsequence:

```yaml
expect:
  hooks:
    sequence:
      - PreToolUse
      - PostToolUse
```

By default other hook starts may appear between configured entries. To require the exact observed event sequence:

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

That fails when the candidate's observed hook-start sequence differs from the baseline, including insertion, removal, or reordering of lifecycle events.

Claude Code runs sibling hooks for the **same event in parallel**. Canary therefore compares event-level lifecycle order, not a fictional deterministic ordering between sibling hook commands. Multiple hooks attached to the same event can produce repeated copies of that event name in the trace.

## Instrumentation is isolated

Permission instrumentation lives in a temporary plugin directory outside the tested Git worktree and is deleted after the run. It does not overwrite project or user hooks. The prompt probe is added only when permission-prompt metrics are requested; the `PermissionDenied` recorder is added only when a denial metric is requested.

Hook streaming is enabled only when hook assertions/comparisons need it (or when `claude.include_hook_events: true` is explicitly configured).

The permission probe necessarily adds a small MCP/plugin schema footprint to runs that request permission metrics. Release comparisons apply the same instrumentation to baseline and candidate. Keep that in mind when interpreting absolute token budgets alongside permission assertions.

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
