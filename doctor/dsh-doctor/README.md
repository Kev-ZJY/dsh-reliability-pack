# dsh-doctor

`dsh-doctor` is a prebuilt, no-build-install CLI for checking a dsh profile,
reporting token-meter drift, and updating only the selected profile's plugin
dependencies.

It never calls `npm install -g`, never edits the dsh installation, and never
repairs token-meter packages, projection caches, or session JSONL files.

## Commands

```sh
dsh-doctor check --profile web
dsh-doctor report-token-meter --profile web
dsh-doctor update-profile --profile web --preview
dsh-doctor update-profile --profile web
```

`check` validates the profile manifest, lockfile, workspace policy, Cordis
patch, and `dsh --profile <name> --dump-config`. `report-token-meter` reads the
token-meter package manifest, configured fingerprints, projection cache, and
optional session records, then prints only diagnostic metadata. The report is
strictly read-only, including when it finds negative cached values.

`update-profile` creates a timestamped backup of `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `cordis.patch.yml` under
`<profile>/.dsh-doctor/backups/` before running the existing profile command:

```text
dsh plugin --profile <name> update
```

It then validates the profile and config dump again. `--preview` does not
create a backup and does not invoke any command. If an update or validation
fails, the backup path is printed and no automatic rollback is attempted after
the update command has run.

## Exit codes

- `0`: the command completed successfully;
- `1`: a profile check, report read, update, or post-update validation failed;
- `2`: command-line arguments are invalid.

Diagnostics redact API keys, bearer credentials, password-like values, and
common provider key formats before printing them.

## Paths and disposable fixtures

By default, profiles are read from `$DSH_HOME/profiles/<profile>` (or
`$HOME/.dsh/profiles/<profile>`), the token-meter cache is
`$DSH_HOME/storages/session_projcache.json`, and the token-meter package is
`$DSH_HOME/node_modules/@deepseek-ai/dsh-token-meter/package.json`.

For tests or a disposable profile, set `DSH_HOME` to the fixture root. The
following explicit overrides are also supported: `DSH_DOCTOR_PROFILE_ROOT`,
`DSH_DOCTOR_PROFILE_MANIFEST`, `DSH_DOCTOR_LOCKFILE`,
`DSH_DOCTOR_WORKSPACE_POLICY`, `DSH_DOCTOR_CORDIS_PATCH`,
`DSH_DOCTOR_TOKEN_METER_PACKAGE`, `DSH_DOCTOR_TOKEN_METER_CACHE`, and
`DSH_DOCTOR_SESSION_RECORDS` (comma- or newline-separated paths).

## Rollback

Read `manifest.json` in the backup directory printed by the doctor, then copy
the four recorded backup files back to their `sourcePath` values. After
checking the restored lockfile and profile manifest, run the profile's normal
dependency/config validation manually. Token-meter caches and session records
are intentionally outside this rollback procedure.
