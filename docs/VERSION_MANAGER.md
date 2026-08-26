# Version manager

Canary can cache isolated Claude Code binaries without replacing the user's normal `claude` installation.

## Why this exists

A regression tester needs two or more Claude Code releases available at the same time. Switching the system-wide install back and forth is slow, mutates user state and makes bisect workflows fragile.

Canary instead downloads the exact release binary into its own cache and passes that binary path to the normal scenario runner.

## Commands

```bash
cc-canary versions install 2.1.89
cc-canary versions install stable
cc-canary versions install latest
cc-canary versions list
cc-canary versions path 2.1.89
```

The `stable` and `latest` channel names are resolved to an exact version before caching.

You can then compare versions directly:

```bash
cc-canary compare .canary/basic.canary.yml --from 2.1.89 --to latest
```

Canary downloads missing versions automatically for `--from` / `--to` and never changes the system-wide Claude Code symlink/install.

## Cache location

Default locations:

- Linux/macOS: `$XDG_CACHE_HOME/claude-code-canary` or `~/.cache/claude-code-canary`
- Windows: `%LOCALAPPDATA%\\claude-code-canary\\cache`

Override with:

```text
CC_CANARY_CACHE_DIR=/custom/cache
```

The layout is:

```text
versions/
  2.1.89/
    win32-x64/
      claude.exe
      manifest.json
```

## Integrity model

Every install fetches the release's `manifest.json` and checks the downloaded binary against `platforms.<platform>.checksum` (SHA256). If the manifest publishes a byte size, Canary checks that too. A cached binary is re-hashed before reuse and replaced if it no longer matches.

This detects corruption and cache tampering. The current alpha implementation does **not yet verify the detached GPG signature on `manifest.json` itself**. Anthropic publishes those signatures for releases 2.1.89 and newer; fail-closed signature verification with the pinned Anthropic key fingerprint is the next security milestone.

Until that lands, environments requiring cryptographic publisher authentication should independently verify the manifest signature or use their own trusted binary cache.

## Supported platforms

The manager currently maps:

- `win32-x64`, `win32-arm64`
- `darwin-x64`, `darwin-arm64`
- `linux-x64`, `linux-arm64`
- `linux-x64-musl`, `linux-arm64-musl`

Linux musl detection uses Node's runtime report when available. You can explicitly choose a release platform with `cc-canary versions install <version> --platform <id>`.
