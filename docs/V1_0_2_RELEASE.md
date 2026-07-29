# Academic RSS Reader v1.0.2

## 插件身份

插件 ID 已从历史社区插件占用的 `rss-reader` 改为 `academic-rss-reader`，显示名称改为 Academic RSS Reader。手动安装目录必须使用：

```text
<Vault>/.obsidian/plugins/academic-rss-reader/
```

由于 Obsidian 以插件 ID 区分插件，旧目录不会被视为同一个插件。手动升级时先关闭 Obsidian，把原 `rss-reader` 目录重命名为 `academic-rss-reader`，再只替换三个发布文件并保留 `data.json`，这样新版首次加载时才能迁移旧 API Key。若选择全新安装，则需在设置中重新选择原有 Vault 数据目录并载入其中的 `rss-reader.sqlite3`；数据库文件名保持不变，无需迁移数据库内容。

## SecretStorage

LLM API Key 通过 Obsidian SecretStorage 管理，`data.json` 只保存 secret 条目名称。若加载到旧版 `llmApiKey`，插件会将其迁入一个不覆盖现有 secret 的条目，删除 `data.json` 中的明文字段，并显示迁移通知。

此 API 要求 Obsidian 1.11.4，因此 `manifest.json` 和 `versions.json` 的最低版本同步提升到 1.11.4。由于 v1.0.0 和 v1.0.1 使用的是旧插件 ID，新的 `versions.json` 只登记新 ID 的首个版本 1.0.2，避免 Obsidian 回退到身份不一致的旧包。

## 网络与路径

- 标题翻译继续默认关闭，首次点击“翻译标题”时会明确提示发送范围和 Google 非正式接口风险。
- 数据目录先使用 Obsidian `normalizePath()` 规范化，再通过现有绝对路径与 Vault containment 检查。
- 损坏或不兼容数据库只会保留原文件并停止数据库服务，不创建恢复库。
- 阅读器与设置页按钮在 hover 时显示高亮、强调边框、阴影和轻微位移，并使用手型指针；禁用按钮使用禁用光标。

## 发布产物

```text
build/
├── obsidian/academic-rss-reader/
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── Academic-RSS-Reader-1.0.2.zip
└── SHA256SUMS.txt
```

项目根目录包含完整 MIT `LICENSE`。
