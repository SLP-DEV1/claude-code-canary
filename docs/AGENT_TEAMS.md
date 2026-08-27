# Agent-team regression testing

Claude Code Canary can observe **real Claude Code agent teams** with the experimental `team-run` workflow and compare saved team snapshots with `team-compare`.

This is deliberately separate from ordinary Canary `run` / `compare` scenarios. Claude Code currently creates real agent teams only in an **interactive session**. In non-interactive `claude -p` / Agent SDK sessions, named agents run as ordinary subagents instead of teammates. Canary refuses to blur those two behaviors.

Official upstream references:

- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/cli-reference

## Quick start

Create a team scenario such as `.canary/team-review.team.yml`:

```yaml
version: 1
name: team-review
prompt: |
  Create an agent team with exactly two teammates named reviewer and tester.
  Give each teammate one small read-only repository inspection task.
  Have them report back, complete their tasks, then shut down cleanly.

claude:
  permission_mode: dontAsk
  timeout_seconds: 1200

expect:
  expected_teammates: [reviewer, tester]
  deny_unexpected_teammates: true
  deny_duplicate_spawns: true
  min_teammates: 2
  min_tasks_created: 2
  min_tasks_completed: 2
  min_messages_sent: 1
  require_all_tasks_completed: true
  require_all_teammates_idle: true
  max_stop_failures: 0
```

Then run it from a real terminal:

```bash
claude-canary team-run .canary/team-review.team.yml
```

To test a specific authenticated Claude Code release through Canary's verified release cache:

```bash
claude-canary team-run .canary/team-review.team.yml --version 2.1.247
```

Canary starts an interactive Claude Code session with the scenario prompt as its initial prompt. When the team is finished, exit Claude normally. Canary then evaluates the observed team lifecycle and writes a JSON artifact under `.canary/results/`.

## Compare two team runs

Run the same scenario with the baseline and candidate releases, then compare the saved artifacts:

```bash
claude-canary team-compare \
  .canary/results/baseline-agent-team.json \
  .canary/results/candidate-agent-team.json
```

The comparison fails on structural regressions such as:

- a baseline teammate disappearing;
- additional duplicate teammate spawns;
- additional teammates that never reach an observed idle transition;
- additional incomplete team tasks;
- additional stop failures;
- fewer completed tasks than the baseline;
- a failed or unsupported candidate run.

Message counts, teammate counts, task counts and coordination duration are also reported as deterministic deltas.

## What Canary observes

Canary injects temporary **observation-only hooks** for the duration of the interactive session:

- `TeammateIdle`
- `TaskCreated`
- `TaskCompleted`
- `StopFailure`
- `PostToolUse` for `Agent` and `SendMessage`

The resulting artifact can contain:

- teammate name;
- teammate agent/subagent type when observable;
- teammate model when observable;
- task IDs and created/completed state;
- message recipient and aggregate message count;
- idle transitions;
- duplicate/orphaned teammate classifications;
- stop-failure count;
- bounded event timestamps and coordination duration.

### Privacy boundary

Canary intentionally does **not** persist the sensitive payloads that make team coordination useful to Claude:

- no Agent spawn prompt;
- no SendMessage message body;
- no task description or task subject;
- no assistant transcript;
- no raw hook input;
- no environment values or credentials.

Only the minimum structural metadata required for regression detection is retained.

Observer logs are bounded to 4 MiB and 5,000 events. Malformed or oversized observer output fails closed instead of producing a misleading compatibility result.

## TTY requirement and CI

`team-run` requires a real interactive TTY. If stdin/stdout are not attached to a terminal, Canary returns an explicit `unsupported` result and does **not** launch Claude.

This is important for CI correctness: adding a normal GitHub Actions mode today would not prove agent-team behavior because Claude Code does not spawn real teammates in non-interactive `-p` sessions. Canary therefore does not pretend that a hosted Action run is equivalent.

`team-compare` is fully non-interactive and CI-safe once you already have two reviewed team-run artifacts.

A future PTY-backed runner can make live team execution automatable without changing the result contract.

## Isolation

For a supported interactive run Canary:

1. resolves the exact repository commit;
2. creates a disposable detached Git worktree;
3. creates a temporary observer script and settings file outside the repository;
4. forces `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` only for the child Claude process;
5. forces `--teammate-mode in-process` so the run does not require tmux/iTerm split panes;
6. injects only the observation hooks listed above;
7. removes the observer runtime directory and worktree when Claude exits.

The scenario cannot override `-p` / `--print`, `--settings`, `--teammate-mode`, or stream input/output format flags, because those would make the observation contract unreliable.

## Experimental status

Agent teams are currently experimental upstream, so Canary marks every team result with:

```json
{
  "kind": "agent-team-run",
  "experimental": true
}
```

The result schema is `schemas/agent-team-result.schema.json` with `schemaVersion: 1`. The experimental marker describes the upstream surface; it does not mean Canary silently changes the schema semantics within a saved result.

## Known limits

- Canary can observe structural coordination, not the semantic quality of teammate messages.
- Interactive Claude output is not captured into Canary artifacts.
- Aggregate token/tool usage across all team members is not yet exposed by this observer because doing so would require relying on private/transcript state rather than the documented hook surface.
- `TeammateIdle` is used as the observable idle signal. A session terminated before idle hooks fire can classify a teammate as orphaned even if upstream was about to shut it down.
- Claude Code's own known agent-team limitations still apply, including task-status lag and one-team-per-session constraints.
