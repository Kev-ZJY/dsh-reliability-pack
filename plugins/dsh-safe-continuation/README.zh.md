# dsh-safe-continuation

`dsh-safe-continuation` 提供的是在 `max-tokens` 结束后的受控续接，而不是
透明的中途恢复。

本包使用并已验证的公开运行时接口：

- 通过 `package.json -> dsh.bundle.patch` 暴露 bundle patch
- 通过公开的 `agent/turn-stopping` 监听形状接收 turn-stop 事件
- 通过公开的 `turn/end` 事件读取该 turn 的稳定结束原因
- 通过公开的 `Agent.steer(...)` 与
  `@deepseek-ai/dsh-llm#createUserMessage(...)` 发送插件来源的用户消息

随包提供的 patch 默认插入一个 `safe-continuation` 行，并保持
`enabled: false`，因此安装后不会改变运行时行为，必须显式启用。

## 启用方式

安装到 disposable profile 后，把插入的 profile 行改成类似这样：

```yaml
- id: safe-continuation
  name: dsh-safe-continuation
  config:
    enabled: true
    prompt: Continue safely.
    maxPerTurn: 1
    maxPerSession: 1
```

推荐发布顺序：

1. 先装到 disposable profile，并运行 `dsh --dump-config`。
2. 在 retry 和 tool guard 验证通过前，保持 `enabled: false`。
3. 只在可以接受“一次额外可见续接提示”的 profile 上再打开 `enabled: true`。

## 预算与拒绝原因

- `maxPerTurn` 限制单个 turn 最多插入多少条可见续接提示，默认是 `1`。
- `maxPerSession` 限制单个 session 最多插入多少条可见续接提示，默认是 `1`。
- `skipWhenToolsPresent` 默认 `true`，该 turn 出现 tool activity 时拒绝续接。
- `skipWhenApprovalPending` 默认 `true`，仍有待处理 approval 时拒绝续接。

运行时会以 fail-closed 方式给出以下拒绝原因：

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

## 移除

要回滚该 bundle，可执行：

```bash
dsh plugin --profile web remove dsh-safe-continuation
```

## 打包约束

- `@deepseek-ai/dsh-llm` 的 peer dependency 范围是 `>=0.1.1-rc.2 <0.1.2`
- 这个范围保持在 rc2 兼容窗口内，同时允许匹配的已打包构建满足依赖，而不把版本钉死到某个补丁号

该包故意不带 install-time build hook。manifest 中不定义 `build`、
`prepare`、`prepack`、`preinstall`、`install` 或 `postinstall`。
