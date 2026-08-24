# dsh-safe-continuation

Task 1 只提供组合包脚手架与运行时 contract，不实现 continuation guard 或
handler。

本脚手架依据已核实的公开运行时接口：

- 通过 `package.json -> dsh.bundle.patch` 暴露 bundle patch
- 通过公开的 `session/event` 监听形状接收 session 事件
- 通过公开的 `request/context` 事件负载读取请求路由元数据

随包提供的 patch 默认插入一个 `safe-continuation` 行，并保持
`enabled: false`，因此安装后不会改变运行时行为。

该包故意不带 install-time build hook。manifest 中不定义 `build`、
`prepare`、`prepack`、`preinstall`、`install` 或 `postinstall`。
