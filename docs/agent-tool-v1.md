# workbuddy-skin 命令参考

`workbuddy-skin` 是唯一公开命令，固定操作 `dreamskin.workbuddy`，不接受
`--target`、`--plugin` 或 `--edition`。

```bash
workbuddy-skin --version
workbuddy-skin paths
workbuddy-skin templates
workbuddy-skin template install <templateId> --as <themeId>
workbuddy-skin theme inspect
workbuddy-skin theme list
workbuddy-skin theme read <themeId>
workbuddy-skin theme create <themeId> [--input <json|@file|->]
workbuddy-skin theme update <themeId> --expected-revision <sha256> --input <json|@file|->
workbuddy-skin theme asset import <themeId> --expected-revision <sha256> --file <image>
workbuddy-skin theme validate <themeId>
workbuddy-skin theme delete <themeId> --expected-revision <sha256>
workbuddy-skin status
workbuddy-skin apply <themeId>
workbuddy-skin verify [--screenshot <png>]
workbuddy-skin preview <themeId> [--screenshot <png>]
workbuddy-skin restore
workbuddy-skin doctor
```

每次调用只向 stdout 写入一个 JSON v1 envelope。修改操作使用 revision 做并发
保护；遇到冲突时应重新读取主题，而不是绕过校验。
