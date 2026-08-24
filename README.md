# dsh Reliability Pack

Opt-in DeepSeek Harness bundles for bounded continuation after output-token
ceilings, targeted retries for provider overloads, read-only file-path
diagnostics, and profile health checks.

The token-meter issue is deliberately detection-only. This repository does not
patch dsh core, `@deepseek-ai/dsh-token-meter`, the global npm installation, or
session caches.

The package directories are independently installable with dsh's profile plugin
commands. See each package README for configuration and verification commands.
