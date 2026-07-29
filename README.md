# Academic RSS Reader

Academic RSS Reader v1.0.2 是面向学术文献初筛的 Obsidian 桌面插件。它在本地管理 RSS 订阅、五类文献篮子、标题翻译、个性化推荐和兴趣分析，不需要 Python sidecar。

## 功能

- 添加、编辑、启停和删除订阅
- 导入 OPML、XML、TXT、粘贴文本和逐行 RSS URL
- 每次启动后首次打开阅读器时静默更新全部启用订阅，也可手动更新全部及单个订阅
- 兼容 RSS 与 Atom，提取标题、作者、期刊、年份、DOI、链接和摘要
- 沿用旧 Streamlit 的稳定 GUID、标题规范化和分层去重规则
- 保留跨订阅关联、状态、推荐结果和旧数据库主数据
- 未读、感兴趣、归档、隐藏、过期五个文献篮子
- 列表状态处理、打开系统浏览器和会话内撤回
- TypeScript TF-IDF/逻辑回归推荐、人工关键词和 OpenAI 兼容 LLM 复核
- 总体及分订阅兴趣分析

## 标题翻译

标题翻译使用 Google 非正式免密网页接口：

- 阅读页按钮在译文和原文之间切换
- 开启后仅翻译视口中的标题，并预取后续 8 条
- 译文缓存在本地 SQLite，关闭显示不会删除缓存
- 设置页只保留目标语言
- RSS 更新不等待翻译，接口失败不影响订阅、阅读、推荐和分析

该接口可能限流、受地区影响或随上游调整失效。译文不保证术语准确，不应用于正式引用。标题由用户设备直接发送给翻译服务，不经过开发者服务器。

## 安装

插件仅支持 Obsidian 桌面端，最低版本为 1.11.4。

将发布 ZIP 解压，使完整目录位于：

```text
<Vault>/.obsidian/plugins/academic-rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

然后在“设置 → 第三方插件”中重新加载并启用 Academic RSS Reader。不要把 ZIP 本身直接放进 `plugins`，也不要只复制 `main.js`。

从旧 ID 升级手动安装时，先关闭 Obsidian，将原插件目录 `rss-reader` 重命名为 `academic-rss-reader`，再只替换其中的 `main.js`、`manifest.json` 和 `styles.css`。保留 `data.json`，新版首次加载时才能迁移其中的旧 LLM API Key。若选择全新安装，则需在设置中重新选择原 Vault 数据目录并载入现有 `rss-reader.sqlite3`。

## 本地数据与备份

首次打开 RSS 面板时，先在设置中选择当前 Vault 内的数据目录，再创建新数据库或载入已有数据库：

```text
<Vault>/<用户选择的数据目录>/
├── rss-reader.sqlite3
└── backups/
```

`data.json` 仍由 Obsidian 保存在插件目录，只记录非敏感设置和 SecretStorage 条目名称。LLM API Key 由 Obsidian SecretStorage 保存；从旧版升级时，插件会迁移旧 `llmApiKey` 并从 `data.json` 删除明文。订阅、文献和推荐数据不会写入插件目录。设置页支持：

- 创建或载入数据库
- 将当前数据库迁移到空目录，或安全载入另一目录中的数据库
- 在危险操作前自动创建保护备份
- 手动备份及恢复 `backups/` 中最近的有效备份

插件不会访问 Vault 外的路径，也不会通过开发者服务器转发数据。数据库校验失败时保留原文件且不创建恢复库。

## 开发与发布

需要 Node.js 18 或更高版本。

```bash
npm install
npm run lint
npm test
npm run build
npm run package
```

发布产物：

```text
build/
├── obsidian/academic-rss-reader/
├── Academic-RSS-Reader-1.0.2.zip
└── SHA256SUMS.txt
```

详细说明：

- [开发说明](docs/DEVELOPMENT.md)
- [v1.0.0 发布说明](docs/V1_RELEASE.md)
- [v1.0.1 发布说明](docs/V1_0_1_RELEASE.md)
- [v1.0.2 发布说明](docs/V1_0_2_RELEASE.md)
- [安全与隐私](SECURITY.md)
- [版本记录](CHANGELOG.md)
