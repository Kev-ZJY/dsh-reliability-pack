# dsh-safe-continuation

Task 1 only scaffolds the bundle package and its runtime contract. It does not
implement continuation guards or handlers yet.

Verified public runtime surface used for this scaffold:

- bundle discovery through `package.json -> dsh.bundle.patch`
- session event delivery through the public `session/event` listener shape
- request-route metadata through the public `request/context` event payload

The shipped patch inserts one `safe-continuation` row with `enabled: false` by
default so installation does not change runtime behavior.

This package intentionally ships no install-time build hooks. The manifest does
not define `build`, `prepare`, `prepack`, `preinstall`, `install`, or
`postinstall`.
