# dsh-overload-retry

`dsh-overload-retry` is an opt-in Cordis bundle for one narrow failure class:
an allow-listed provider reports `PI_AI_ERROR` with configured overload
wording. It retries the failed request at the `agent/request-error` boundary
with a bounded, cancellable delay.

The package is already wired through the loader entry exported by
`src/index.ts`: the default export is `apply(ctx, config)`. `apply` registers a
prepended request-error listener and installs disposal through `ctx.effect`.
The built-in `dsh-llm-retry` listener remains downstream in the same waterfall.

## Profile installation

The package manifest exposes `dsh.bundle.patch` as `./cordis.patch.yml`. The
patch inserts this row into a profile:

```yaml
- id: overload-retry
  name: dsh-overload-retry
  config:
    enabled: false
    providers: [openrouter1]
    maxRetries: 8
```

The starter row is disabled. Enable it only after installing the bundle in a
disposable profile and checking the composed config:

```yaml
config:
  enabled: true
  providers: [openrouter1]
  maxRetries: 8
  initialDelayMs: 250
  maxDelayMs: 4000
  jitterRatio: 0.2
  messagePatternIgnoreCase: true
  messagePatterns:
    - '\\btemporarily\\s+overloaded\\b'
    - '\\bupstream\\b[\\s\\S]{0,80}\\boverload(?:ed)?\\b'
    - '\\bservice\\b[\\s\\S]{0,80}\\b(?:overload(?:ed)?|capacity)\\b'
```

The direct API default is deliberately fail-closed (`enabled: false`,
`maxRetries: 0`); the patch row explicitly supplies the rollout budget of 8.
The default provider allow-list is `openrouter1`.

## Ownership and matching

For an exact match, this plugin appends a redacted diagnostic, waits, and
returns `{ kind: 'retry' }` without calling downstream recovery. It handles
only:

- a provider exactly present in `providers`;
- failure code `PI_AI_ERROR`;
- a message matching one of `messagePatterns`;
- no committed `tool/call` or `tool/result` for the failed turn and step;
- a retry count below `maxRetries`.

Every other case calls `next()` exactly once. This preserves
`dsh-llm-retry` as the owner of ordinary `SERVER`, `RATE_LIMIT`, `TIMEOUT`,
`TRANSPORT`, and other non-overload recovery. Authentication, authorization,
quota, billing, invalid-request, context-limit, and similar exclusion text
also fails closed even when overload wording is present. A partial stream is
not resumed from a cursor.

`messagePatterns` are JavaScript regular-expression sources. Matching is
case-insensitive only when `messagePatternIgnoreCase` is true. Invalid or
short custom patterns fail closed instead of throwing.

## Cancellation and diagnostics

Backoff waits use the request `AbortSignal`; plugin disposal aborts its own
lifetime signal, unregisters the listener, and drains active waits. A
cancelled or disposed wait returns no retry action. Retries stop at exactly
`maxRetries`; durable `dsh-overload-retry/diagnostic` events keep the attempt
count for the current session.

Diagnostics contain session coordinates, provider, failure code/status, retry
number, and delay. They do not copy API keys, prompts, request IDs, or full
provider responses.

## Removal

Remove the bundle from a profile with:

```bash
dsh plugin --profile web remove dsh-overload-retry
```

This removes the plugin row and its request-error listener; it does not change
`dsh-llm-retry`, dsh core, or token-meter state.
