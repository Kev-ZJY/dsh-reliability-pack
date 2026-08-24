# safe-continuation task 3 report

Date: 2026-08-24

Status: DONE

## Modified files

- `plugins/dsh-safe-continuation/src/continuation.ts`
- `plugins/dsh-safe-continuation/src/index.ts`
- `plugins/dsh-safe-continuation/package.json`
- `plugins/dsh-safe-continuation/README.md`
- `plugins/dsh-safe-continuation/tests/continuation.test.ts`
- `plugins/dsh-safe-continuation/tests/runtime-contract.test.ts`
- `plugins/dsh-safe-continuation/lib/index.js`
- `plugins/dsh-safe-continuation/lib/index.d.ts`

## Implemented runtime wiring

- added `installSafeContinuation(ctx, options): Disposable`
- subscribed only to the public `agent/turn-stopping` seam
- built steering messages with public `createUserMessage(...)` from `@deepseek-ai/dsh-llm`
- sent plugin-authored user messages through public `Agent.steer(UserMessage)`
- kept the package publish contract on prebuilt `lib/`

## Runtime behavior implemented

- opt-in only: disabled config never steers
- reads durable turn outcome from public session `turn/end` events
- per-turn key dedupe using `sessionId:turn`
- bounded per-session continuation counter
- skips on:
  - non-`max-tokens` finishes
  - tool activity in the same turn
  - queued inbox input (`nextTurn` / `nextStep`)
  - pending approval (`approval/asked` without matching `approval/decided`)
  - already-aborted stop signal
  - disposed listener
- emits redacted diagnostics only:
  - `sessionId`
  - `turnKey`
  - `step`
  - `reason`
  - `attempt`
- diagnostics never include prompt text or credential-like payloads

## Dependency update

- declared `@deepseek-ai/dsh-llm` as:
  - `peerDependencies: ">=0.1.1-rc.2 <0.1.2"`
  - `devDependencies: "0.1.1-rc.2"`
- the wider peer range keeps the package compatible with rc2-matching patch releases while still targeting the verified public API used by this task

## TDD record

Red:

```text
$ node --test --experimental-strip-types tests/continuation.test.ts
SyntaxError: The requested module '../src/index.ts' does not provide an export named 'installSafeContinuation'
```

That established the missing Task 3 runtime seam before production code was added.

Green and full verification:

```text
$ node --test --experimental-strip-types tests/continuation.test.ts
ℹ pass 6
ℹ fail 0

$ npm test
ℹ tests 19
ℹ pass 19
ℹ fail 0

$ npm run typecheck
[exit 0]

$ npm run bundle
✔ Build complete

$ npm run bundle
✔ Build complete
```

## Temporary local verification setup

- created temporary package-local symlinks under `plugins/dsh-safe-continuation/node_modules/` to:
  - `@deepseek-ai/dsh-llm`
  - `typescript`
  - `tsdown`
  - `@types/node`
  - `.bin/tsc`
  - `.bin/tsdown`
- used them only to run tests, typecheck, and bundle in this restricted workspace
- they are not part of the committed result and were removed before finalizing

## Remaining risks

- runtime tool / approval detection is intentionally based on public durable session events and public inbox state only; it does not inspect any agent-loop private state
- Task 4 profile smoke / README expansion is intentionally not included here
