# dsh Reliability Pack

面向 DeepSeek Harness 的可选可靠性插件集合：输出 token 上限后的受控续接、供应商过载重试、只读文件路径诊断，以及 profile 健康检查工具。

token-meter 问题仅检测和报告。本仓库不会修改 dsh 内核、`@deepseek-ai/dsh-token-meter`、全局 npm 安装或会话缓存。

各目录可独立安装到 dsh profile。safe-continuation、overload-retry 和路径诊断默认关闭；路径诊断始终只读。`dsh-doctor` 是独立 CLI，用于 profile 检查、token-meter 报告和带备份的 profile 更新。

详见各包文档：

- `plugins/dsh-safe-continuation`
- `plugins/dsh-overload-retry`
- `plugins/dsh-path-diagnostics`
- `doctor/dsh-doctor`
