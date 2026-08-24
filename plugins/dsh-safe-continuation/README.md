# dsh-safe-continuation

Task 3 wires runtime continuation through the public `agent/turn-stopping`
event and steers via public `Agent.steer(UserMessage)` plus
`@deepseek-ai/dsh-llm#createUserMessage`.

Verified public runtime surface used for this package:

- bundle discovery through `package.json -> dsh.bundle.patch`
- turn-stop delivery through the public `agent/turn-stopping` listener shape
- durable turn outcome through public session `turn/end` events
- plugin-authored user messages through public `createUserMessage(...)`

The shipped patch inserts one `safe-continuation` row with `enabled: false` by
default so installation does not change runtime behavior.

Peer dependency policy:

- `@deepseek-ai/dsh-llm` is declared as `>=0.1.1-rc.2 <0.1.2`
- the peer range stays within the rc2-compatible patch window while allowing a
  matching bundled build to satisfy the package without pinning one exact patch

This package intentionally ships no install-time build hooks. The manifest does
not define `build`, `prepare`, `prepack`, `preinstall`, `install`, or
`postinstall`.
