# Navigating large static reports

`claude-canary report <results-dir>` generates a portable static HTML report at `<results-dir>/html/index.html` by default.

The report stays local-first and self-contained. It does not require a web server, external JavaScript, analytics or a Canary-hosted service, and it does not embed raw prompts, transcripts or environment values.

## Navigation for large result sets

The HTML report provides client-side navigation so hundreds or thousands of local artifacts remain practical to inspect:

- search across artifact titles, filenames, result labels, failure messages and failure fingerprints;
- filter by result state: failing, passing or informational;
- filter by artifact kind, such as suite, run, watch or flake;
- sort by newest, oldest, title, kind or failures-first;
- paginate at 25, 50 or 100 rows, or show all matching rows;
- click the summary cards to jump directly to all, passing, failing or informational artifacts;
- use **First failure** to filter to failures and jump to the first matching artifact;
- expand failure details only when they are needed;
- preserve search/filter/sort/page state in the report URL so a local view can be bookmarked or copied.

Keyboard shortcuts:

- `/` focuses report search;
- `Esc` clears the search field while it is focused.

## Suite summaries

Suite artifacts expose their scenario counts directly in the report table when the evidence contains them. The metrics column can show total, passed, failed and selection-skipped scenario counts without expanding the underlying result JSON.

## CLI

```bash
claude-canary report .canary/results
```

Choose another output directory or title when needed:

```bash
claude-canary report .canary/results \
  --output artifacts/canary-report \
  --title "Release compatibility report"
```

The generated `index.html` can be opened directly from disk or published as an ordinary static artifact.
