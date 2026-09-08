# Scheduled Claude Code release watch in GitHub Actions

`claude-canary watch` is designed for recurring compatibility checks. A scheduled GitHub Actions runner is ephemeral, so the important part is not the cron expression itself: the workflow must carry `.canary/watch-state.json` across runs and must not persist a transient infrastructure failure as accepted watch progress.

A complete copy-paste example lives at [`examples/github-actions/scheduled-watch.yml`](../examples/github-actions/scheduled-watch.yml).

## Before enabling the schedule

1. Commit a deterministic suite, normally `.canary/release.suite.yml`.
2. Add the `ANTHROPIC_API_KEY` repository secret required by the scenarios that actually launch Claude.
3. Add repository variable `CLAUDE_CANARY_KNOWN_GOOD` with an exact `x.y.z` Claude Code release that you have already tested successfully.
4. Copy the example workflow into `.github/workflows/claude-canary-watch.yml`.

The explicit known-good variable matters only when no cached watch state exists yet. Without a reviewed starting point, `watch` normally initializes the newest published release as known-good without testing it. The example fails closed on the first run instead.

## What the scheduled workflow does

The example runs every six hours and can also be launched manually. It uses a concurrency group with `cancel-in-progress: false`, so two watch jobs cannot race to update the same logical state.

Before running Canary it restores the newest previous `.canary/watch-state.json` from the GitHub Actions cache. Each run uses a unique cache key and a stable restore prefix; this avoids trying to overwrite immutable cache entries while still restoring the newest earlier state.

Canary itself runs with `continue-on-error: true`. That is deliberate: the workflow needs to inspect Canary's structured exit code and decide whether the new state is safe to persist before finally failing the job.

## Exit codes and state persistence

The recommended persistence policy is:

| Exit | Meaning | Persist watch state? | Why |
| --- | --- | --- | --- |
| `0` | no change / initialized / compatible | yes | progress is valid |
| `2` | compatibility regression | yes | the release was genuinely tested; keep `lastKnownGood` while recording it as observed |
| `3` | infrastructure failure | **no** | restore the previous state next time so the candidate is retried |
| `4` | configuration error | no | fix configuration before advancing state |

This distinction is important for scheduled CI. A runner outage, download error or other infrastructure failure must not make a new Claude Code release disappear from the next watch run merely because a local state file was written during the failed attempt.

The example therefore uses separate `actions/cache/restore` and `actions/cache/save` steps and only saves state after exit `0` or `2`. The final step then propagates Canary's original failure category back to the GitHub Actions job.

## Regression behavior

When a new release fails the suite, `watch` keeps the prior `lastKnownGood`, records the candidate as observed, and can bisect the published release range using the first failing scenario. The generated Markdown/JSON watch artifacts are uploaded by the composite Action even though the outer workflow ultimately fails with exit `2`.

Because the regression state is persisted, the same already-observed bad release does not fail every scheduled run forever. A later newly published release becomes the next candidate while the known-good baseline remains pinned until a compatible release passes.

## Artifacts and summaries

The Action writes release-watch JSON and Markdown under `.canary/results/`, adds the Markdown report to the GitHub Step Summary, and uploads the results as a workflow artifact. The example retains those artifacts for 30 days and gives each run a unique artifact name.

The watch state itself is intentionally separate from result artifacts. Results are evidence for humans and CI; the cached state is the small mutable cursor that tells the next scheduled invocation what has already been observed.

## Large suites

Keep a scheduled watch bounded. Configure suite-level `max_runs`, use a conservative `concurrency`, and consider a dedicated release-watch tag if only a smaller set of critical scenarios must gate every upstream Claude Code release.

For example:

```yaml
with:
  mode: watch
  suite: .canary/release.suite.yml
  tag: release-critical
  concurrency: "2"
```

Do not shard one logical watch across independent scheduled jobs that each mutate their own state unless you intentionally maintain separate watch cursors. One state file should correspond to one compatibility decision surface.

## Read-only release discovery

For a manual or separate discovery job, `check-only` reports unseen releases without launching Claude and without mutating the watch state:

```yaml
with:
  mode: watch
  suite: .canary/release.suite.yml
  watch-state: .canary/watch-state.json
  check-only: "true"
```

`check-only` is most useful when a previous state file is restored first. Because it intentionally does not advance state, repeated invocations continue to report the same unseen release until a real watch run tests it.

## Security notes

The example gives the workflow only `contents: read`. The upstream checkout/cache actions are pinned to immutable commit SHAs. The Canary Action uses the documented `v2` major channel so consumers receive compatible v2 fixes; repositories that require full supply-chain pinning can replace that tag with a reviewed immutable Canary commit SHA.

Do not persist API keys, prompts, transcripts or arbitrary environment dumps in the watch-state cache. Canary's state file contains only the release cursor and status metadata; normal portable result/evidence privacy rules still apply.
