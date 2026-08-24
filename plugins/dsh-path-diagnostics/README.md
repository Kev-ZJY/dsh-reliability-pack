# dsh-path-diagnostics

`dsh-path-diagnostics` is an opt-in Cordis bundle that adds a read-only hint
when a filesystem `read` fails with the structured `FS_NOT_FOUND` code. It
searches for a same-basename file under the current session workspace and
emits a sidecar diagnostic only when exactly one safe candidate exists.

The original post-execute result remains authoritative. The bundle does not
rewrite the failed path, retry the operation, or change a worker error whose
structured filesystem fields were stripped.

## Profile installation

The package manifest exposes `dsh.bundle.patch` as `./cordis.patch.yml`. The
patch mounts this optional row:

```yaml
- id: path-diagnostics
  name: dsh-path-diagnostics
  config:
    enabled: false
    readOnly: true
    maxDepth: 4
    maxCandidates: 8
    maxSearchEntries: 2000
    suggestOnlyWhenUnique: true
```

The row is disabled by default. Enable it only after installing the bundle in
a disposable profile and checking the composed configuration:

```yaml
config:
  enabled: true
  readOnly: true
  maxDepth: 4
  maxCandidates: 8
  maxSearchEntries: 2000
  suggestOnlyWhenUnique: true
```

## Search and safety rules

- Search is limited to the session workspace (`agent.session.header.cwd`).
- Traversal is bounded by `maxDepth`, `maxCandidates`, and
  `maxSearchEntries`; the defaults are 4, 8, and 2000.
- Only a unique same-basename file is reported. Zero matches, ambiguous
  matches, a missing parent, a search error, or an aborted search fail closed.
- Directory entries and path metadata are used; file contents are never read.
- Symlink entries and paths outside the workspace are ignored or rejected.
- No write, edit, path rewrite, or automatic candidate selection is performed.

The diagnostic includes the requested path, the unique candidate, and the
instruction to re-read the candidate explicitly before editing or continuing.
Treat the hint as a suggestion: inspect the candidate and issue an explicit
read yourself before making any change.

## Verification

From the repository root:

```bash
pnpm --filter dsh-path-diagnostics test
pnpm --filter dsh-path-diagnostics typecheck
node --test --experimental-strip-types tests/profile/path-diagnostics-smoke.test.ts
pnpm --filter dsh-path-diagnostics bundle
```

To remove the bundle from a profile:

```bash
dsh plugin --profile web remove dsh-path-diagnostics
```
