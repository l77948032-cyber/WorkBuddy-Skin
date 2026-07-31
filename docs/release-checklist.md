# WorkBuddy Skin 发布检查

1. 运行 `npm ci`。
2. 运行 `npm run release:check`。
3. 确认 `workbuddy-skin --version` 与包版本一致。
4. 确认 npm tarball 只有 `workbuddy-skin` 一个 bin 和
   `dreamskin.workbuddy` 一个运行时。
5. 在 macOS 实机执行 `status`、`apply`、`verify`、`restore`。
6. 标签必须为 `v<package.json version>`。
