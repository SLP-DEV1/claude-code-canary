# Version manager

Canary can cache isolated Claude Code binaries without replacing the user's normal `claude` installation.

## Why this exists

A regression tester needs two or more Claude Code releases available at the same time. Switching the system-wide install back and forth is slow, mutates user state and makes bisect workflows fragile.

Canary instead downloads the exact release binary into its own cache and passes that binary path to the normal scenario runner.

## Commands

```bash
claude-canary versions install 2.1.89
claude-canary versions install stable
claude-canary versions install latest
claude-canary versions list
claude-canary versions path 2.1.89
```

The `stable` and `latest` channel names are resolved to an exact version before caching.

You can then compare versions directly:

```bash
claude-canary compare .canary/basic.canary.yml --from 2.1.89 --to latest
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
trust/
  claude-code.asc
versions/
  2.1.89/
    win32-x64/
      claude.exe
      manifest.json
      install.json
```

`install.json` records the checksum, size, verification time, and whether the release was authenticated by a signed manifest or only by a checksum for legacy releases.

## Integrity and authenticity model

For Claude Code **2.1.89 and newer**, Canary verifies the detached `manifest.json.sig` before trusting any checksum from the manifest.

The verification chain is:

1. fetch Anthropic's release signing key from `https://downloads.claude.ai/keys/claude-code.asc`
2. parse the key with OpenPGP in-process; Canary never reads or modifies the user's GPG keyring
3. require the exact pinned fingerprint `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE`
4. verify `manifest.json.sig` against the exact downloaded manifest bytes
5. only after that, read `platforms.<platform>.checksum`
6. hash the downloaded Claude Code binary and require an exact SHA256 match
7. verify the published byte size when present

If the signing key fingerprint differs, the detached signature is missing, or signature verification fails, installation fails closed.

Anthropic publishes detached manifest signatures starting with release **2.1.89**. Earlier releases do not have them, so Canary marks those installs explicitly as `checksum-only` instead of pretending they have publisher authentication.

A cached binary is re-hashed before every reuse. The current release manifest is fetched and authenticated again, so a locally modified cached executable is rejected and replaced.

The signing key is cached under Canary's own cache directory only after its fingerprint has matched the hard-coded Anthropic fingerprint. A corrupted/replaced cached key is discarded and fetched again.

## Supported platforms

The manager currently maps:

- `win32-x64`, `win32-arm64`
- `darwin-x64`, `darwin-arm64`
- `linux-x64`, `linux-arm64`
- `linux-x64-musl`, `linux-arm64-musl`

Linux musl detection uses Node's runtime report when available. You can explicitly choose a release platform with `claude-canary versions install <version> --platform <id>`.
