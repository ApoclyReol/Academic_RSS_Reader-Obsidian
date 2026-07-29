# Changelog

## 1.0.2 — 2026-07-29

- 插件 ID 和名称改为 `academic-rss-reader` 与 Academic RSS Reader。
- LLM API Key 改用 Obsidian SecretStorage，并自动迁移旧 `data.json` 明文字段。
- 用户首次启用实验性标题翻译时，明确提示标题将发送给 Google。
- 用户输入的数据目录先经 Obsidian `normalizePath()` 规范化，再执行 Vault containment 检查。
- 阅读器与设置页按钮增加更明显的 hover 高亮、边框、阴影和位移反馈，并使用手型指针。
- 发布目录和 ZIP 改为 `academic-rss-reader/` 与 `Academic-RSS-Reader-1.0.2.zip`。
- 最低 Obsidian 版本提升到 1.11.4；项目继续使用 MIT License。

## 1.0.1 — 2026-07-28

- 自动更新改为每次启动后首次打开 RSS Reader 时静默执行，不再在 Obsidian 启动时弹出更新提示。
- 手动更新仍显示进度和结果，便于主动操作时确认状态。
- 插件启动时不再在插件目录创建或打开数据库；首次使用必须选择 Vault 内的数据目录。
- RSS 面板在数据库未配置时显示引导，数据库就绪后才启动业务服务。
- 支持创建、载入和安全切换数据库，迁移当前库时不会覆盖目标文件。
- 所有手动及危险操作保护备份统一保存到用户数据目录的 `backups/`。
- 损坏数据库只读校验失败时保留原文件，不创建插件目录恢复库。
- 正式版本不提供旧数据库导入功能。

## 1.0.0 — 2026-07-28

- 将 Streamlit RSS Reader 完整迁移为 Obsidian 桌面插件。
- 保留旧版 SQLite 核心表、stable GUID、标题规范化和分层去重规则。
- 提供订阅管理、五篮子阅读、撤回、推荐和兴趣分析。
- 增加视口标题翻译、后续 8 条预取和本地译文缓存。
- 增加 Vault 内数据库备份、恢复、损坏回退和一次性错误 GUID 修复。
- 发布包收敛为 `main.js`、`manifest.json`、`styles.css` 三个文件。
