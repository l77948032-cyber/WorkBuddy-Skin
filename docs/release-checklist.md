# WorkBuddy Skin 发布检查

1. 运行 `npm ci`。
2. 运行 `npm run release:check`。
3. 确认 `workbuddy-skin --version` 与包版本一致。
4. 确认 npm tarball 只有 `workbuddy-skin` 一个 bin 和
   `dreamskin.workbuddy` 一个运行时。
5. 确认 CI 在 Linux、macOS 与 Windows 上完成 CLI、运行时清单和 npm 包测试。
6. 在 macOS 实机执行 `status`、`apply`、`verify`、`restore`。
7. 在 Windows 10 / 11 实机确认官方签名识别、普通实例退出、主题实例启动、回环 CDP、
   watcher 持久化、`verify` 截图和 `restore` 原生重启。
8. Windows 需要至少检查 100%、125% 和 150% 显示缩放下的首页、对话、项目与设置页面。
9. 标签必须为 `v<package.json version>`。
