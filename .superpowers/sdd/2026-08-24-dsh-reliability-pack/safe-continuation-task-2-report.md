# safe-continuation task 2 report

Date: 2026-08-24

## Modified files

- `plugins/dsh-safe-continuation/src/index.ts`
- `plugins/dsh-safe-continuation/src/config.ts`
- `plugins/dsh-safe-continuation/src/guards.ts`
- `plugins/dsh-safe-continuation/tests/guards.test.ts`
- `plugins/dsh-safe-continuation/lib/index.js`
- `plugins/dsh-safe-continuation/lib/index.d.ts`

## Implemented interface

- `ContinuationConfig`
  - `{ enabled, maxPerTurn, maxPerSession, prompt, skipWhenToolsPresent, skipWhenApprovalPending }`
- `ContinuationConfigInput`
  - optional input form accepted by normalization
- `normalizeContinuationConfig(input?)`
  - fills defaults
  - keeps `enabled: false` by default
- `ContinuationObservation`
  - `{ finishKind, hasToolActivity, approvalPending, queuedInput, aborted, turnKey, turnCount, sessionCount }`
- `ContinuationDecision`
  - `{ continue, reason }`
- `decideContinuation(config, observation)`
  - pure function
  - returns fixed diagnostic reasons
  - fail-closed on malformed numeric limits
  - does not let `prompt` text affect the decision

## Decision behavior covered by tests

- disabled by default
- continue only on `finishKind === "max-tokens"`
- skip on tool activity when configured
- skip on approval pending when configured
- skip on queued input
- skip on aborted turns
- reject duplicate delivery when `maxPerTurn === 1`
- enforce per-turn and per-session budgets
- fail closed for malformed `maxPerTurn` and `maxPerSession`
- treat `prompt` as opaque text only

## Verification commands and output

Red phase:

```text
$ node --test --experimental-strip-types /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/tests/guards.test.ts
SyntaxError: The requested module '../src/index.ts' does not provide an export named 'decideContinuation'
✖ fail 1
```

Focused green test:

```text
$ node --test --experimental-strip-types /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/tests/guards.test.ts
✔ normalization disables continuation by default
✔ continues only after a max-tokens stop when limits allow it
✔ skips continuation when tool activity is present and the guard is enabled
✔ skips continuation for approval, queue, and abort conditions
✔ rejects duplicate delivery for single-turn continuation budgets
✔ enforces per-turn and per-session budgets
✔ fails closed when numeric limits are malformed instead of throwing
✔ treats the prompt as opaque text that does not influence decisions
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

Package test suite:

```text
$ npm test
✔ normalization disables continuation by default
✔ continues only after a max-tokens stop when limits allow it
✔ skips continuation when tool activity is present and the guard is enabled
✔ skips continuation for approval, queue, and abort conditions
✔ rejects duplicate delivery for single-turn continuation budgets
✔ enforces per-turn and per-session budgets
✔ fails closed when numeric limits are malformed instead of throwing
✔ treats the prompt as opaque text that does not influence decisions
✔ dsh-safe-continuation loader contract is wired through the package manifest
✔ dsh-safe-continuation package manifest forbids install-time build scripts
✔ published declarations reference only existing package-local files
✔ dsh-safe-continuation runtime adapter accepts the inspected event shape
✔ dsh-safe-continuation request/context validator rejects invalid payloads
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Typecheck:

```text
$ npm run typecheck
> dsh-safe-continuation@0.1.0 typecheck
> tsc --pretty false --project tsconfig.json
[exit 0]
```

Bundle:

```text
$ npm run bundle
> dsh-safe-continuation@0.1.0 bundle
> tsdown && node ./scripts/normalize-lib.mjs

ℹ tsdown v0.22.14 powered by rolldown v1.2.4
ℹ entry: ./src/index.ts, ./src/runtime-types.ts
ℹ Build start
ℹ Cleaning 4 files
ℹ lib/index.js            2.38 kB
ℹ lib/runtime-types.js    1.09 kB
ℹ lib/index.d.ts          1.73 kB
ℹ lib/runtime-types.d.ts  1.21 kB
✔ Build complete
```

Note on local verification environment:

- `npm run typecheck` and `npm run bundle` initially failed because `tsc`/`tsdown` were not on the package-local `PATH`.
- Verification completed by temporarily symlinking package-local `node_modules` entries to the already available read-only toolchain under `/Users/kevin_zjy/.dsh/plugins/dsh-operating-context/node_modules`.
- Those temporary symlinks were removed after verification and were not committed.

## Risks

- `decideContinuation()` is intentionally pure and stateless in this task. Duplicate-turn handling currently relies on the caller passing accurate `turnCount` and `sessionCount`; no runtime event deduplication or Cordis wiring is implemented here.
- The `turnKey` field is preserved in the public observation shape for future wiring, but this task does not consume it directly.
- Verification of `npm run typecheck` and `npm run bundle` depends on the same external local toolchain path remaining available until the package gets its own installed dependencies in a normal environment.
