# Academic RSS Reader v1.5.0

[English](V1_5_0_RELEASE.md) | 简体中文

本次功能更新增加 RSS 与 Atom 原生摘要图支持。

## 新增与改进

1. 从 item 级 media 字段、图片 enclosure、Atom enclosure 或订阅摘要 HTML
   中提取摘要图；插件不会抓取文章页面。
2. 文献卡片使用稳定的内容/图片双分区，支持图片懒加载、加载失败回退和按图片尺寸调整的
   放大预览。
3. 标题固定预留三行，可选择复制文本，并使用 Obsidian 原生 MathJax 渲染带分隔符的
   LaTeX 片段。
4. 订阅管理只保留一个期刊字段，在可能时修复旧 OPML 异常元数据，并优化订阅管理和
   兴趣分析表格。

## 数据库升级

schema 5 增加可空的 `items.image_url` 字段，不下载或回填旧文献图片。v3 数据库会先升级
到 v4，再升级到 v5；v4 数据库只执行 v5。现有保护备份和失败回滚机制保持不变。

> [!IMPORTANT]
> 需要 Obsidian 1.13.0 或更高版本的桌面端。若内置运行环境不兼容，插件会提示升级
> Obsidian。

只安装 GitHub Release 中的 `main.js`、`manifest.json` 和 `styles.css`。
