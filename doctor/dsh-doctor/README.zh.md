# dsh-doctor

`dsh-doctor` 是一个预构建、无需安装时编译的 CLI，用于检查 dsh profile、只读报告
token-meter 漂移，以及只更新指定 profile 的插件依赖。

它不会调用 `npm install -g`，不会修改 dsh 安装本体，也不会修复 token-meter 包、
projection cache 或 session JSONL 文件。

## 命令

```sh
dsh-doctor check --profile web
dsh-doctor report-token-meter --profile web
dsh-doctor update-profile --profile web --preview
dsh-doctor update-profile --profile web
```

`check` 检查 profile manifest、lockfile、workspace policy、Cordis patch，以及
`dsh --profile <name> --dump-config`。`report-token-meter` 读取 token-meter 包
manifest、配置的 fingerprint、projection cache 和可选的 session record，只输出
诊断元数据。即使发现负数缓存值，report 也始终只读。

`update-profile` 会在执行已有 profile 更新命令前，把 `package.json`、
`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `cordis.patch.yml` 备份到
`<profile>/.dsh-doctor/backups/`，然后执行：

```text
dsh plugin --profile <name> update
```

更新后会再次检查 profile 和 config dump。`--preview` 不创建备份，也不执行任何
命令。如果更新或更新后的检查失败，CLI 会打印备份路径；更新命令已经运行后不会
自动回滚。

## 退出码

- `0`：命令成功完成；
- `1`：profile 检查、report 读取、更新或更新后校验失败；
- `2`：命令行参数无效。

输出前会脱敏 API key、Bearer 凭据、密码类字段和常见 provider key 格式。

## 路径与 disposable fixture

默认从 `$DSH_HOME/profiles/<profile>` 读取 profile（未设置时使用
`$HOME/.dsh/profiles/<profile>`），token-meter cache 为
`$DSH_HOME/storages/session_projcache.json`，token-meter 包 manifest 为
`$DSH_HOME/node_modules/@deepseek-ai/dsh-token-meter/package.json`。

测试或 disposable profile 可以把 `DSH_HOME` 指向 fixture 根目录。也支持以下显式
覆盖项：`DSH_DOCTOR_PROFILE_ROOT`、`DSH_DOCTOR_PROFILE_MANIFEST`、
`DSH_DOCTOR_LOCKFILE`、`DSH_DOCTOR_WORKSPACE_POLICY`、`DSH_DOCTOR_CORDIS_PATCH`、
`DSH_DOCTOR_TOKEN_METER_PACKAGE`、`DSH_DOCTOR_TOKEN_METER_CACHE` 和
`DSH_DOCTOR_SESSION_RECORDS`（使用逗号或换行分隔多个路径）。

## 回滚

读取 doctor 打印的备份目录中的 `manifest.json`，再把其中四个 backup 文件复制回
对应的 `sourcePath`。确认 lockfile 和 profile manifest 恢复后，手动执行 profile 的
依赖与配置检查。token-meter cache 和 session record 不属于此回滚范围。
