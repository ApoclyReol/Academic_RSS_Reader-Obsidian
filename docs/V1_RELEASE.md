# RSS Reader v1.0.0

## 发布定位

v1.0.0 是从 Streamlit 迁移到 Obsidian 桌面插件技术栈后的首个正式版本。运行时为纯 TypeScript，不依赖 Python sidecar。

## 已交付

- RSS/Atom 订阅管理、导入、启停和更新
- 与旧 Streamlit 兼容的 GUID、规范化、去重和数据库核心表
- 未读、感兴趣、归档、隐藏、过期五篮子工作流
- 系统浏览器打开原文
- 视口标题翻译、后续 8 条预取和 SQLite 缓存
- TypeScript 个性化推荐、人工关键词和 LLM 复核
- 兴趣分析
- Vault 内数据库备份、恢复和损坏回退
- 预发布错误 GUID 的一次性安全修复

## 不包含

- Obsidian 移动端
- 全文或摘要翻译
- 正式云翻译 Provider 或多服务自动切换
- AI 润色、术语表和研究信息提取
- 自动生成 Markdown 归档笔记
- 常驻定时抓取

## 已知边界

- Google 免密网页翻译是实验性接口，可能限流或失效。
- LLM 复核需要用户自行配置 OpenAI 兼容服务。
- SQLite 数据库适用于单个桌面 Obsidian 实例，不支持多个进程同时写入同一文件。
- 插件布局最小宽度为 760px，窄窗口会横向滚动。

## 发布验收

- `npm run lint` 无错误
- `npm test` 全部通过
- `npm run build` 成功
- 发布 ZIP 只含三个必需文件
- 独立 Vault 冷启动成功
- 数据库完整性与外键检查通过
- CNKI 重复更新不新增旧条目
- 翻译服务失效时其他模块仍可使用
- 断网时可浏览现有本地数据
