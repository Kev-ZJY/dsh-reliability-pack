# dsh-safe-continuation

`dsh-safe-continuation` adds bounded post-turn continuation after a
`max-tokens` finish. It does not attempt transparent mid-stream resume.

Runtime surface used by this package:

- bundle discovery through `package.json -> dsh.bundle.patch`
- turn-stop delivery through the public `agent/turn-stopping` listener shape
- durable turn outcome through public session `turn/end` events
- plugin-authored user messages through public `Agent.steer(...)` plus
  `@deepseek-ai/dsh-llm#createUserMessage(...)`

The shipped patch inserts one `safe-continuation` row with `enabled: false` by
default, so installing the package does not change runtime behavior until you
opt in.

## Enablement

After installing the package into a disposable profile, enable it by changing
the inserted profile row:

```yaml
- id: safe-continuation
  name: dsh-safe-continuation
  config:
    enabled: true
    prompt: Continue safely.
    maxPerTurn: 1
    maxPerSession: 1
```

Recommended rollout:

1. Install into a disposable profile and run `dsh --dump-config`.
2. Keep `enabled: false` until your retry/tool-guard checks pass.
3. Flip `enabled: true` only for profiles where one extra post-turn prompt is acceptable.
   If `enabled: true` and `prompt` is empty or whitespace, a built-in default prompt
   (`'Continue exactly where you left off and complete the truncated response.'`) will be used.

## Budgets And Refusals

- `maxPerTurn` bounds visible continuation prompts for one turn; the default is `1`.
- `maxPerSession` bounds visible continuation prompts for one session; the default is `1`.
- `skipWhenToolsPresent` defaults to `true` and refuses continuation after tool activity in that turn.
- `skipWhenApprovalPending` defaults to `true` and refuses continuation while an approval request is still open.

The runtime fails closed with these refusal reasons:

- `disabled`
- `invalid-max-per-turn`
- `invalid-max-per-session`
- `finish-kind-not-max-tokens`
- `tool-activity`
- `approval-pending`
- `queued-input`
- `aborted`
- `duplicate-turn`
- `per-turn-budget-exhausted`
- `per-session-budget-exhausted`

## Rollback

Remove the bundle from a profile with:

```bash
dsh plugin --profile web remove dsh-safe-continuation
```

## Packaging

Peer dependency policy:

- `@deepseek-ai/dsh-llm` is declared as `>=0.1.1-rc.2 <0.1.2`
- the peer range stays within the rc2-compatible patch window while allowing a
  matching bundled build to satisfy the package without pinning one exact patch

This package intentionally ships no install-time build hooks. The manifest does
not define `build`, `prepare`, `prepack`, `preinstall`, `install`, or
`postinstall`.
