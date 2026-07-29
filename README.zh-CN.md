# Academic RSS Reader

[English](README.md)

Academic RSS Reader 是面向学术文献初筛的桌面插件。它在本地管理 RSS/Atom 订阅、五类文献篮子、标题翻译、个性化推荐和兴趣分析，不需要 Python sidecar。

## 功能

- 添加、编辑、启停和删除订阅。
- 导入 OPML、XML、TXT、粘贴文本和逐行 RSS URL。
- 每次启动后首次打开阅读器时在后台更新全部启用订阅，也可手动更新全部及单个订阅。
- 提取标题、作者、期刊、年份、DOI、链接和摘要，并保持稳定 GUID、标题规范化和分层去重。
- 使用未读、感兴趣、归档、隐藏、过期五个文献篮子管理状态。
- 每批连续加载 100 条，支持打开系统浏览器和会话内撤回。
- 使用 TypeScript TF-IDF/逻辑回归、人工关键词和可选的 OpenAI 兼容 LLM 复核进行推荐。
- 支持视口标题翻译、总体及分订阅兴趣分析。
- 界面自动跟随应用语言：中文环境显示简体中文，英文及其他语言环境显示英文。

## 标题翻译

标题翻译使用 Google 非正式免密网页接口。只翻译视口中的标题并预取后续 8 条，译文缓存在本地 SQLite。该接口可能限流、受地区影响或随上游调整失效；译文不保证术语准确，不应用于正式引用。标题由用户设备直接发送给翻译服务，不经过开发者服务器。

## 安装

插件仅支持桌面端，最低版本为 1.11.4。从对应 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`，放入：

```text
<Vault>/.obsidian/plugins/academic-rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

然后重新加载第三方插件并启用 Academic RSS Reader。

从旧 ID 手动升级时，先关闭应用，将原插件目录 `rss-reader` 重命名为 `academic-rss-reader`，再只替换三个发布文件。保留 `data.json`，新版首次加载时才能将旧 LLM API Key 迁移到 SecretStorage。

## 本地数据与备份

首次使用时，在当前 Vault 内选择数据目录，再创建新数据库或载入已有数据库：

```text
<Vault>/<用户选择的数据目录>/
├── rss-reader.sqlite3
└── backups/
```

运行时文件操作全部通过 Vault adapter 和规范化的 Vault 相对路径完成；插件拒绝绝对路径和越界路径。订阅、文献、翻译和推荐数据保存在 SQLite，LLM API Key 保存在 SecretStorage。

设置页支持创建、载入、安全迁移、切换数据库、手动备份及恢复最近有效备份。插件不会在启动时自动创建数据库；校验失败时保留原文件。

## 开发与发布

需要 Node.js 18 或更高版本。

```bash
npm install
npm run lint
npm test
npm run build
npm run package
```

本地 `build/` 会生成三文件插件目录、手动安装 ZIP 和 SHA-256 校验文件。GitHub Release 只发布 `main.js`、`manifest.json`、`styles.css`，并由 GitHub Actions 为这三个文件生成来源证明。

## 文档

- [开发说明](docs/DEVELOPMENT.md)
- [安全与隐私](SECURITY.md)
- [版本记录](CHANGELOG.md)
- [v1.1.0 发布说明](docs/V1_1_0_RELEASE.md)

## 许可证

[MIT](LICENSE)
