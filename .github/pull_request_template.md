## What changed

Describe the change and the regression-testing or compatibility problem it solves. Keep the scope focused enough that reviewers can reason about one behavior at a time.

## Verification

- [ ] `npm ci --ignore-scripts --no-audit --no-fund`
- [ ] `npm run check`
- [ ] Tests or fixtures were added/updated for behavior changes, or the change is documentation/metadata only
- [ ] Public schemas, CLI/Action/API docs and examples were updated when their contract changed
- [ ] `CHANGELOG.md` was updated when the change should appear in release notes

## Security and privacy

- [ ] No permission mode or trust boundary is silently weakened
- [ ] No raw prompt/model output, credential, token, private path or other sensitive data is added to portable artifacts by default
- [ ] New subprocess/file/network behavior is bounded and fails closed where practical

## Compatibility notes

List affected Claude Code versions, operating systems, providers/gateways, plugin/MCP surfaces or `stream-json` fixtures. Write `None` when there is no compatibility impact.
