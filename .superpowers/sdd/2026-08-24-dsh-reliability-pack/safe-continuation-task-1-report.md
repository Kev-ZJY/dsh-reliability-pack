# safe-continuation task 1 report

Date: 2026-08-24

## Modified files

- `plugins/dsh-safe-continuation/package.json`
- `plugins/dsh-safe-continuation/tsconfig.json`
- `plugins/dsh-safe-continuation/tsdown.config.ts`
- `plugins/dsh-safe-continuation/cordis.patch.yml`
- `plugins/dsh-safe-continuation/src/index.ts`
- `plugins/dsh-safe-continuation/src/runtime-types.ts`
- `plugins/dsh-safe-continuation/tests/runtime-contract.test.ts`
- `plugins/dsh-safe-continuation/scripts/normalize-lib.mjs`
- `plugins/dsh-safe-continuation/lib/index.js`
- `plugins/dsh-safe-continuation/lib/index.d.ts`
- `plugins/dsh-safe-continuation/lib/runtime-types.js`
- `plugins/dsh-safe-continuation/lib/runtime-types.d.ts`
- `plugins/dsh-safe-continuation/README.md`
- `plugins/dsh-safe-continuation/README.zh.md`

## Verified public API

Observed from globally installed `@deepseek-ai/dsh@0.1.1-rc.2` artifacts and public type declarations:

- Bundle discovery is manifest-driven through `package.json -> dsh.bundle.patch`, not code scanning.
- Profile patch files are top-level YAML arrays consumed as `cordis.patch.yml`.
- Public session event delivery is `ctx.on('session/event', (session, event) => ...)` with `Session` plus `SessionEvent`.
- Public route metadata for the next request is carried by the `request/context` event payload with `{ provider, model, contextWindow? }`.
- Public durable session metadata includes `Session.header.id` and related `SessionHeader` fields.
- `@deepseek-ai/dsh-token-meter` publicly measures `measure(session, requestHeader?)` and uses bounded session/event folds; task 1 kept this as a read-only boundary and did not patch token-meter behavior.

Additional rc2 evidence captured during fix round 1:

- Global version probe:
  - command: `node -p "require('/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json').version"`
  - result: `0.1.1-rc.2`
- evidence path: `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json`
- evidence path: `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`
- evidence path: `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` (`agent/turn-stopping` payload `{ agent, turn, signal }`)
- evidence path: `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` and adjacent public `Agent` declaration (`Agent.steer(message)`)

## Verification commands and output

1. Red-phase command required by brief

```text
pnpm --filter dsh-safe-continuation test
```

Expected reason to fail at that point: package absent. In this environment the command did not produce a usable non-interactive failure message before the scaffold existed, so the later runtime-contract verification below was used as the authoritative evidence record.

2. Contract test

```text
$ npm run test

> dsh-safe-continuation@0.1.0 test
> node --test --experimental-strip-types tests/**/*.test.ts

✔ dsh-safe-continuation loader contract is wired through the package manifest (1.946ms)
✔ dsh-safe-continuation package manifest forbids install-time build scripts (0.09925ms)
✔ dsh-safe-continuation runtime adapter accepts the inspected event shape (0.846667ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 79.46025
```

3. Typecheck command

```text
$ npm run typecheck

> dsh-safe-continuation@0.1.0 typecheck
> tsc --pretty false --project tsconfig.json

sh: tsc: command not found
```

4. Fix round 1 reproducible red-phase evidence on the parent commit of `ab55a75`

```text
$ git worktree add /Users/kevin_zjy/.dsh/reliability-pack/.worktrees/safe-continuation-red-phase 2a23262e218f71113e5c2cfc383608a11017b48a
Preparing worktree (detached HEAD 2a23262)
HEAD is now at 2a23262 chore: scaffold dsh reliability pack

$ test -d /Users/kevin_zjy/.dsh/reliability-pack/.worktrees/safe-continuation-red-phase/plugins/dsh-safe-continuation; echo $?
1

$ npm --prefix /Users/kevin_zjy/.dsh/reliability-pack/.worktrees/safe-continuation-red-phase/plugins/dsh-safe-continuation test
npm error code ENOENT
npm error syscall open
npm error path /Users/kevin_zjy/.dsh/reliability-pack/.worktrees/safe-continuation-red-phase/plugins/dsh-safe-continuation/package.json
npm error errno -2
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/Users/kevin_zjy/.dsh/reliability-pack/.worktrees/safe-continuation-red-phase/plugins/dsh-safe-continuation/package.json'
```

5. Fix round 1 current red test after tightening the contract

```text
$ npm run test

> dsh-safe-continuation@0.1.0 test
> node --test --experimental-strip-types tests/**/*.test.ts

✖ dsh-safe-continuation loader contract is wired through the package manifest
...
AssertionError [ERR_ASSERTION]:
+ actual - expected

+ './src/index.ts'
- './lib/index.js'
```

6. Dependency install attempt blocked during fix round 1

```text
$ npm install --no-package-lock --save-dev typescript tsdown @types/node
```

This command did not complete and produced no diagnostic output before manual interruption in the current restricted environment, so `typecheck`/`bundle` remained blocked by missing toolchain dependencies.

## Fix round 1 status

Completed and preserved:

- corrected API verification source to the global rc2 installation path
- added reproducible parent-commit red-phase evidence via a temporary git worktree
- tightened `runtime-contract.test.ts` to require `lib` exports and explicit `request/context` validator coverage
- ignored `.worktrees/` in repo `.gitignore`

Still not fixed in this commit:

- package manifest still exports `src`, not prebuilt `lib`
- no `tsdown` config or toolchain declarations landed yet
- `tsconfig.json` still does not include `tests/**/*.test.ts`
- `typecheck` and `bundle` remain blocked by missing local toolchain dependencies

## Unresolved risks

- Fix round 1 ends in a known red state: the tightened contract test now fails against the current manifest because the prebuilt `lib` contract is not implemented yet.
- Dependency installation did not complete in the current environment, so no fresh `typecheck` or `bundle` evidence exists.
- The scaffold still intentionally stops at manifest/patch/loader/runtime-type contract. No continuation guard, handler, or token-meter behavioral integration is implemented in task 1.

## Fix round 2 status

Completed and preserved:

- `package.json` now publishes `./lib/index.js` and `./lib/runtime-types.js`
- declared minimal `devDependencies`: `typescript ^5.9.2`, `tsdown ^0.22.2`, `@types/node ^22.19.0`
- added non-install-time `bundle` script only
- `tsconfig.json` now includes both `src/**/*.ts` and `tests/**/*.test.ts`
- added `tsdown.config.ts` to build `src/index.ts` and `src/runtime-types.ts` into `lib`
- generated and retained committed publishable artifacts:
  - `lib/index.js`
  - `lib/index.d.ts`
  - `lib/runtime-types.js`
  - `lib/runtime-types.d.ts`
- runtime contract test now checks manifest `lib` exports, built-file existence/importability, and `request/context` validator positive/negative cases

Fix round 2 local-tool verification:

```text
$ /Users/kevin_zjy/.dsh/plugins/dsh-operating-context/node_modules/.bin/tsc --pretty false --project /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/tsconfig.json
[exit 0]

$ /Users/kevin_zjy/.dsh/plugins/dsh-operating-context/node_modules/.bin/tsdown
ℹ tsdown v0.22.14 powered by rolldown v1.2.4
ℹ config file: /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/tsdown.config.ts
ℹ entry: ./src/index.ts, ./src/runtime-types.ts
ℹ tsconfig: tsconfig.json
ℹ Build start
ℹ lib/runtime-types.mjs    1.09 kB │ gzip: 0.33 kB
ℹ lib/index.mjs            0.09 kB │ gzip: 0.10 kB
ℹ lib/runtime-types.d.mts  1.21 kB │ gzip: 0.36 kB
ℹ lib/index.d.mts          0.50 kB │ gzip: 0.26 kB
ℹ 4 files, total: 2.89 kB
✔ Build complete

$ node /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/scripts/normalize-lib.mjs
[exit 0 on first successful normalization; a repeated invocation later returned ENOENT because the .mjs/.d.mts files had already been renamed]

$ ls -la /Users/kevin_zjy/.dsh/reliability-pack/plugins/dsh-safe-continuation/lib
index.d.ts
index.js
runtime-types.d.ts
runtime-types.js

$ node --test --experimental-strip-types tests/**/*.test.ts
✔ dsh-safe-continuation loader contract is wired through the package manifest
✔ dsh-safe-continuation package manifest forbids install-time build scripts
✔ dsh-safe-continuation runtime adapter accepts the inspected event shape
✔ dsh-safe-continuation request/context validator rejects invalid payloads
ℹ pass 4
ℹ fail 0
```

Remaining limitations at fix round 2 close:

- local package `npm install` was still not relied on; verification used the explicitly provided existing toolchain under `/Users/kevin_zjy/.dsh/plugins/dsh-operating-context/node_modules/.bin/`
- `bundle` script is declared for ordinary environments, but this round's proof used the absolute-path local `tsdown` plus the checked-in normalization step

## Fix round 3 status

Scoped findings fixed:

- `tsdown.config.ts` now imports `defineConfig` from the package dependency name `tsdown`; it contains no sibling installation path.
- `tsconfig.json` now uses the standard `types: ["node"]` setting without a sibling `typeRoots` override. The package manifest remains the source of the TypeScript, tsdown, and Node type declarations.
- `tsdown.config.ts` requests `.js` ESM output. `scripts/normalize-lib.mjs` remains a compatibility cleanup for older tsdown output, removes conflicting generated targets, and rewrites relative `.mjs`/`.mts` declaration references to `.js`.
- `runtime-contract.test.ts` now reads `lib/index.d.ts`, rejects `.mjs`/`.mts` references, and checks every relative declaration target exists.
- A clean bundle removed the审查工具留下的 `lib/index.mjs`, `lib/runtime-types.mjs`, `lib/index.d.mts`, and `lib/runtime-types.d.mts`. Final `lib` contains only `index.js`, `index.d.ts`, `runtime-types.js`, and `runtime-types.d.ts`.
- Temporary package-local symlinks used only for verification were removed; no `node_modules` directory or sibling-plugin file was committed.

## Fix round 3 verification

The requested offline installation was attempted once and did not wait on the network:

```text
$ npm install --offline --no-package-lock --ignore-scripts
npm error code ENOTCACHED
npm error request to https://registry.npmmirror.com/@types%2fnode failed: cache mode is 'only-if-cached' but no cached response is available.
```

Using temporary, uncommitted symlinks to the already available local executables, the package scripts were run successfully:

```text
$ npm run typecheck
> dsh-safe-continuation@0.1.0 typecheck
> tsc --pretty false --project tsconfig.json
[exit 0]

$ npm run bundle
ℹ tsdown v0.22.14 powered by rolldown v1.2.4
ℹ Cleaning 4 files
ℹ lib/runtime-types.js    1.09 kB
ℹ lib/index.js            0.09 kB
ℹ lib/runtime-types.d.ts  1.21 kB
ℹ lib/index.d.ts          0.49 kB
✔ Build complete in 379ms

$ npm test
✔ dsh-safe-continuation loader contract is wired through the package manifest
✔ dsh-safe-continuation package manifest forbids install-time build scripts
✔ published declarations reference only existing package-local files
✔ dsh-safe-continuation runtime adapter accepts the inspected event shape
✔ dsh-safe-continuation request/context validator rejects invalid payloads
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

The final declaration begins with `import { SafeContinuationEnvelope } from "./runtime-types.js";`; the final `lib` scan found no `.mjs` or `.mts` files or declaration references. A repository scan of implementation/config files found no hard-coded `dsh-operating-context/node_modules` path.

## Fix round 3 remaining risks

- This environment cannot install the declared devDependencies offline because the npm cache lacks `@types/node`; a normal package consumer still needs the declared dependencies available from its registry/cache.
- Task 1 remains intentionally limited to the loader/runtime contract and does not implement later guard, handler, or token-meter behavior.
