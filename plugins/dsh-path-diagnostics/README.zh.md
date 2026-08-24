# dsh-path-diagnostics

`dsh-path-diagnostics` 是一个可选的 Cordis bundle：只有当文件系统的
`read` 操作以结构化错误码 `FS_NOT_FOUND` 失败时，它才会在当前 session
workspace 内进行只读搜索。找到唯一的同名文件后，插件追加 sidecar
diagnostic；原始 post-execute 结果始终保持权威。

插件不会改写失败路径、重试操作、执行 write/edit，也不会在 worker error
已经丢失结构化字段时改写原始错误。

## Profile 安装

包清单通过 `dsh.bundle.patch` 暴露 `./cordis.patch.yml`。patch 会挂载下面
这个可选行，默认保持关闭：

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

建议先安装到 disposable profile 并检查组合后的配置，再显式打开：

```yaml
config:
  enabled: true
  readOnly: true
  maxDepth: 4
  maxCandidates: 8
  maxSearchEntries: 2000
  suggestOnlyWhenUnique: true
```

## 搜索与安全边界

- 搜索根目录是 `agent.session.header.cwd` 指定的 session workspace。
- 遍历受 `maxDepth`、`maxCandidates`、`maxSearchEntries` 限制，默认值分别为
  4、8、2000。
- 只有唯一的同名文件才会被报告；零匹配、多个匹配、父目录不存在、搜索
  失败或被取消都会 fail closed，不会猜测候选。
- 只使用目录项和路径元数据，不读取文件内容。
- 不跟随符号链接逃出 workspace；workspace 外的路径会被拒绝。
- 不执行写入、编辑、路径重写或自动选择候选。

sidecar 会包含请求路径、唯一候选和“先显式重新读取，再编辑或继续”的固定
指令。它只是建议：请先检查候选，并自行发起显式 read，再做任何修改。

## 验证

在仓库根目录运行：

```bash
pnpm --filter dsh-path-diagnostics test
pnpm --filter dsh-path-diagnostics typecheck
node --test --experimental-strip-types tests/profile/path-diagnostics-smoke.test.ts
pnpm --filter dsh-path-diagnostics bundle
```

从 profile 移除 bundle：

```bash
dsh plugin --profile web remove dsh-path-diagnostics
```
