# dsh-overload-retry

`dsh-overload-retry` 是一个可选的 Cordis bundle，只处理一类窄错误：
允许列表中的 provider 返回 `PI_AI_ERROR`，且错误文本命中配置的 overload
模式。它在 `agent/request-error` 边界执行有上限、可取消的退避重试。

本包已经通过 `src/index.ts` 导出的 loader 入口装配：默认导出是
`apply(ctx, config)`。`apply` 注册一个 prepended request-error listener，并通过
`ctx.effect` 接入 dispose；同一个 waterfall 中内置的 `dsh-llm-retry` 保持在
下游。

## Profile 安装

包清单通过 `dsh.bundle.patch` 暴露 `./cordis.patch.yml`。patch 会向 profile
插入如下行：

```yaml
- id: overload-retry
  name: dsh-overload-retry
  config:
    enabled: false
    providers: [openrouter1]
    maxRetries: 8
```

插入行默认关闭。应先安装到 disposable profile 并检查组合后的配置，再显式开启：

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

直接调用 API 时默认是 fail-closed（`enabled: false`、`maxRetries: 0`）；patch
行显式提供发布时使用的 8 次预算。默认 provider 允许列表是 `openrouter1`。

## 重试归属与匹配

精确命中时，本插件追加脱敏 diagnostic，等待后返回 `{ kind: 'retry' }`，不会
调用下游恢复。必须同时满足：

- provider 与 `providers` 中的值完全相同；
- failure code 是 `PI_AI_ERROR`；
- message 命中 `messagePatterns`；
- 失败 turn/step 没有已提交的 `tool/call` 或 `tool/result`；
- 当前重试次数小于 `maxRetries`。

其他所有情况都会恰好调用一次 `next()`，因此普通的 `SERVER`、`RATE_LIMIT`、
`TIMEOUT`、`TRANSPORT` 及其他非 overload 恢复仍由 `dsh-llm-retry` 负责。认证、
授权、配额、计费、非法请求、上下文上限等排除文本即使同时出现 overload 词也会
fail-closed；部分流不会从 cursor 中途续传。

`messagePatterns` 使用 JavaScript 正则表达式 source；只有
`messagePatternIgnoreCase: true` 时才忽略大小写。非法或过短的自定义模式会
fail-closed，不会抛出异常。

## 取消与诊断

退避等待同时使用 request `AbortSignal`；插件 dispose 会中止自己的 lifetime
signal、注销 listener，并等待已有 wait 结束。取消或 dispose 后不会返回 retry
action。重试严格停止在 `maxRetries`；持久化的
`dsh-overload-retry/diagnostic` 事件会在当前 session 中保留次数。

diagnostic 只包含 session 坐标、provider、failure code/status、重试次数和延迟，
不会复制 API key、prompt、request ID 或完整 provider response。

## 移除

从 profile 移除 bundle：

```bash
dsh plugin --profile web remove dsh-overload-retry
```

这只移除插件行及其 request-error listener，不会修改 `dsh-llm-retry`、dsh core
或 token-meter。
