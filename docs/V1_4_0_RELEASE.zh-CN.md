# Academic RSS Reader v1.4.0

[English](V1_4_0_RELEASE.md) | 简体中文

本次更新让阅读器更快、更安全、更稳定：

- 使用原生 SQLite，支持自动保护备份和 v3 数据库原地升级。
- 改进文献去重，避免升级后首次更新产生重复文献。
- 自动更新会跳过一小时内成功更新过的订阅，手动更新始终执行。
- 卡片标题固定为两行空间，相关性和正负关键词显示更紧凑。
- 推荐、翻译缓存以及 LLM/RSS 安全性进一步增强。

> [!IMPORTANT]
> 仅支持 Obsidian 1.13.0 或更高版本的桌面端，内置运行时还需提供 Node.js 22.16+ 和
> `node:sqlite`；不满足要求时无法载入数据库。

> [!IMPORTANT]
> 升级前请关闭其他 Obsidian 实例。插件会在迁移 v3 数据库前自动创建保护备份；插件运行时
> 不要替换数据库文件。

只安装 GitHub Release 中的 `main.js`、`manifest.json` 和 `styles.css`。
