# RSS Reader for Obsidian

RSS Reader v1.0.0 是面向学术文献初筛的 Obsidian 桌面插件。它在本地管理 RSS 订阅、五类文献篮子、标题翻译、个性化推荐和兴趣分析，不需要 Python sidecar。

## v1.0.0 功能

- 添加、编辑、启停和删除订阅
- 导入 OPML、XML、TXT、粘贴文本和逐行 RSS URL
- 启动时更新全部启用订阅，或手动更新全部及单个订阅
- 兼容 RSS 与 Atom，提取标题、作者、期刊、年份、DOI、链接和摘要
- 沿用旧 Streamlit 的稳定 GUID、标题规范化和分层去重规则
- 保留跨订阅关联、状态、推荐结果和旧数据库主数据
- 未读、感兴趣、归档、隐藏、过期五个文献篮子
- 列表状态处理、打开系统浏览器和会话内撤回
- TypeScript TF-IDF/逻辑回归推荐、人工关键词和 OpenAI 兼容 LLM 复核
- 总体及分订阅兴趣分析
- 旧版 SQLite 只读预览、备份和导入

## 标题翻译

标题翻译使用 Google 非正式免密网页接口：

- 阅读页按钮在译文和原文之间切换
- 开启后仅翻译视口中的标题，并预取后续 8 条
- 译文缓存在本地 SQLite，关闭显示不会删除缓存
- 设置页只保留目标语言
- RSS 更新不等待翻译，接口失败不影响订阅、阅读、推荐和分析

该接口可能限流、受地区影响或随上游调整失效。译文不保证术语准确，不应用于正式引用。标题由用户设备直接发送给翻译服务，不经过开发者服务器。

## 安装

插件仅支持 Obsidian 桌面端，最低版本为 1.8.0。

将发布 ZIP 解压，使完整目录位于：

```text
<Vault>/.obsidian/plugins/rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

然后在“设置 → 第三方插件”中重新加载并启用 RSS Reader。不要把 ZIP 本身直接放进 `plugins`，也不要只复制 `main.js`。

## 本地数据与备份

运行数据库固定为：

```text
<Vault>/.obsidian/plugins/rss-reader/rss-reader.sqlite3
```

设置只保存在同目录的 `data.json`。设置页可选择 Vault 内的相对备份目录，推荐 `Assets/RSS Reader`，并执行：

- 导出带时间戳的数据库备份
- 从所选目录中最近修改的 SQLite 文件恢复

插件不会把运行数据库切换到 Vault 外，也不会通过开发者服务器转发数据。数据库异常时插件使用独立恢复库启动，原文件保持不变。

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
├── obsidian/rss-reader/
├── RSS-Reader-1.0.0.zip
└── SHA256SUMS.txt
```

详细说明：

- [开发说明](docs/DEVELOPMENT.md)
- [旧版数据迁移](docs/LEGACY_MIGRATION.md)
- [v1.0.0 发布说明](docs/V1_RELEASE.md)
- [安全与隐私](SECURITY.md)
- [版本记录](CHANGELOG.md)
