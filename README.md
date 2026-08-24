# dsh Reliability Pack

Opt-in DeepSeek Harness bundles for bounded continuation after output-token
ceilings, targeted retries for provider overloads, read-only file-path
diagnostics, and profile health checks.

The token-meter issue is deliberately detection-only. This repository does not
patch dsh core, `@deepseek-ai/dsh-token-meter`, the global npm installation, or
session caches.

The package directories are independently installable with dsh's profile plugin
commands. The safe-continuation and overload-retry bundles are disabled by
default; path diagnostics is also disabled by default and remains read-only.
`dsh-doctor` is a standalone CLI for profile checks, token-meter reporting, and
transactional profile updates.

See the package READMEs for configuration, removal, and verification commands:

- `plugins/dsh-safe-continuation`
- `plugins/dsh-overload-retry`
- `plugins/dsh-path-diagnostics`
- `doctor/dsh-doctor`
