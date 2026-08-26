# dsh Reliability Pack

面向 DeepSeek Harness 的可选可靠性插件集合：输出 token 上限后的受控续接、供应商过载重试、只读文件路径诊断，以及 profile 健康检查工具。

token-meter 问题仅检测和报告。本仓库不会修改 dsh 内核、`@deepseek-ai/dsh-token-meter`、全局 npm 安装或会话缓存。

各目录可独立安装到 dsh profile。safe-continuation、overload-retry 和路径诊断默认关闭；路径诊断始终只读。`dsh-doctor` 是独立 CLI，用于 profile 检查、token-meter 报告和带备份的 profile 更新。

## 包含插件

| 包 | 说明 | 默认状态 |
|---|---|---|
| `plugins/dsh-safe-continuation` | `max-tokens` 结束后受控续接，可配置次数/会话上限、跳过条件、自定义提示词 | 关闭 (`enabled: false`) |
| `plugins/dsh-overload-retry` | 针对指定 provider 的过载错误自动退避重试，双轨计数（持久化+内存）保证预算准确 | 关闭 (`enabled: false`) |
| `plugins/dsh-path-diagnostics` | `read` 失败 `FS_NOT_FOUND` 时只读诊断、建议唯一候选路径，symlink/逃逸双重防护 | 关闭 (`enabled: false, readOnly: true`) |

## 包含工具

| 工具 | 说明 |
|---|---|
| `doctor/dsh-doctor` | 独立 CLI：`check`（profile 健康检查）、`report-token-meter`（只读漂移报告）、`update-profile`（备份→更新→校验） |

## 快速开始

### 安装到 profile

```bash
# 创建或复用一个 profile
dsh plugin --profile my-profile add /path/to/dsh-reliability-pack/plugins/dsh-safe-continuation
dsh plugin --profile my-profile add /path/to/dsh-reliability-pack/plugins/dsh-overload-retry
dsh plugin --profile my-profile add /path/to/dsh-reliability-pack/plugins/dsh-path-diagnostics
```

> 也可直接指向 GitHub 仓库路径（`dsh plugin add git+https://...#main:plugins/...`）。

### 启用插件

编辑 `~/.dsh/profiles/my-profile/cordis.patch.yml`，在对应 bundle 的 `config` 下把 `enabled: true`：

```yaml
# safe-continuation 示例
- id: safe-continuation
  name: dsh-safe-continuation
  config:
    enabled: true
    maxPerTurn: 1
    maxPerSession: 3
    prompt: "Continue where you left off."
    skipWhenToolsPresent: true
    skipWhenApprovalPending: true

# overload-retry 示例
- id: overload-retry
  name: dsh-overload-retry
  config:
    enabled: true
    providers: ["openrouter1"]
    maxRetries: 5
    initialDelayMs: 250
    maxDelayMs: 4000
    jitterRatio: 0.2
    messagePatterns:
      - '\btemporarily\s+overloaded\b'
      - '\bupstream\b[\s\S]{0,80}\boverload(?:ed)?\b'

# path-diagnostics 示例
- id: path-diagnostics
  name: dsh-path-diagnostics
  config:
    enabled: true
    readOnly: true
    maxDepth: 4
    maxCandidates: 8
    maxSearchEntries: 2000
    suggestOnlyWhenUnique: true
```

也可用 `dsh plugin --profile my-profile update` 更新依赖后再启用。

### 运行 doctor 健康检查

```bash
# 检查 profile 完整性
dsh-doctor check --profile my-profile

# 只读 token-meter 漂移报告
dsh-doctor report-token-meter --profile my-profile

# 预览更新（不落盘）
dsh-doctor update-profile --profile my-profile --preview

# 真实更新（自动备份，失败时打印备份路径）
dsh-doctor update-profile --profile my-profile
```

## 关键特性

### 受控续接（dsh-safe-continuation）

- 仅在 `turn/end` 的 `reason.kind === 'max-tokens'` 时考虑续接
- 守卫：每轮/会话预算、工具活动、审批队列、输入队列、aborted 信号、重复投递去重
- `prompt` 为空且 `enabled: true` 时自动回退内置默认文案
- dispose 时自动清理计数器，避免长进程内存增长

### 过载重试（dsh-overload-retry）

- 两段式持久化：`retry-scheduled`（计划）+ `retry-started`（真正重试前写入），**abort 期间不消耗预算**
- 双轨计数取 `max(持久化计数, 内存计数)`，持久化间歇不可用时内存轨道正常递增，上限不被突破
- 排除模式收窄为具体误报样例，避免误杀真实过载
- 正则编译结果 `WeakMap` 缓存，热路径零开销
- listener 顶层 `try/catch`，插件异常委托 `next()` 不放大失败

### 路径诊断（dsh-path-diagnostics）

- `read` 失败 `FS_NOT_FOUND` 时 BFS 有界搜索唯一候选
- workspace root 为 symlink 直接拒绝；遍历遇 symlink 跳过；`relative()` 防 `..` 逃逸
- `candidates.length > maxCandidates` 优先于 multiple-matches 返回，行为确定
- 全流程 `try/catch` 吞异常，best-effort 不影响主流程

### Profile 健康检查（dsh-doctor）

- `check`：manifest/lockfile/workspace-policy/cordis-patch/config-dump 五项
- **cordis-patch 空补丁（`[]`/仅注释）现在被判合法**，符合 `dsh plugin add` 初始化的真实状态
- `update-profile` 区分：
  - 验证器自身异常 → `exit 0` + 脱敏警告 + 备份路径（更新已成功）
  - 校验明确失败 → `exit 1`（fail-closed）
- 备份四文件（package.json/lockfile/workspace.yaml/patch.yml）到 `.dsh-doctor/backups/<ts>/`

## 配置 Schema（Cordis 加载期校验）

三个插件均导出 `Config`（Schemastery schema），字段与默认值严格对齐运行期 `normalize` 逻辑。Cordis 在加载插件时即校验配置并填默认值，配置错误在加载期即可暴露，而非运行期静默 skip。

## 测试与质量

```bash
# 全仓库测试
npm test

# 单包测试
npm -F dsh-safe-continuation test
npm -F dsh-overload-retry test
npm -F dsh-path-diagnostics test
npm -F dsh-doctor test

# 类型检查
npm run typecheck
```

当前：89 个测试全部通过（28 + 24 + 13 + 24），四包 typecheck 全绿。

## 兼容性

- 目标 DSH：`@deepseek-ai/dsh >=0.1.1-rc.2 <0.1.2`
- 当前本机/registry 最新为 `0.1.1-rc.2`，**不存在更新版本**，升级不兼容风险为零
- 依赖 `@deepseek-ai/schemastery ^3.18.1`（官方内置 bundle 同版本）

## 目录结构

```
dsh-reliability-pack/
├── plugins/
│   ├── dsh-safe-continuation/      # 受控续接 bundle
│   ├── dsh-overload-retry/         # 过载重试 bundle
│   └── dsh-path-diagnostics/       # 路径诊断 bundle
├── doctor/
│   └── dsh-doctor/                 # 独立 CLI 工具
├── tests/profile/                  # 端到端冒烟测试
├── package.json                    # pnpm workspace 根
├── pnpm-workspace.yaml
└── tsconfig.base.json              # 共享 TS 配置
```

## 许可证

MIT