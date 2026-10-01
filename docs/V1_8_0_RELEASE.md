# Academic RSS Reader v1.8.0

## English

This release makes continuous browsing more compact and clarifies paper states, interest rates, and update times.

### Reading layout

- Translation, sorting, undo, and batch actions remain visible alongside the top navigation while scrolling. Toolbar buttons and spacing are more compact.
- Enable **Settings → Paper cards → Adjust card height to content** for naturally wrapping titles and no empty field slots. Text abstracts show up to three lines; graphical abstracts use a bounded preview.
- Dynamic height is off by default. Uniform cards continue to derive their height from the enabled information rows; disabling authors or text abstracts removes the corresponding reserved space.

### Paper states

| Previous name | New name | Meaning |
|---|---|---|
| Unread | To screen | No decision yet |
| Interested | Following | Interested, for further reading |
| Archived | Saved | Interested and archived |
| Hidden | Skipped | Not interested |
| Expired | Expired | Skipped papers past their retention period; still not interested |

Existing papers use the new labels while retaining their classifications, identities, and feed associations.

### Statistics and time fixes

- Interest rate is **(following + saved) / (following + saved + skipped + expired)**. Papers to screen are excluded. Moving skipped papers to expired no longer changes the rate.
- A feed with one saved, two skipped, and seventeen expired papers has an interest rate of **5.0%**.
- Both subscription update timestamps and the last-update summary use the system's local timezone. SQLite timestamps without a timezone are interpreted as UTC.

### Titles and translation caches

- Convert HTML markup and character entities in RSS/Atom titles to clean text, remove redundant whitespace, and retain math fragments.
- Repair historical titles and cached title translations in every target language. Markup-only changes reuse translations. Actual source-content changes exclude stale translations from cards and search, and refresh them when title translation is enabled.
- Fix forced retranslation reusing a successful cache entry, and prevent late translation results for an old source from overwriting newer tasks.
- Corrigendum and Erratum notices remain separate papers with a correction badge, a short title, and expandable full original and translated titles. Parsing no longer treats the cited original paper's year or a DOI in the notice body as the correction's own metadata.

### Upgrade notes

The database upgrades to **schema 6**. The first load after upgrading maintains historical titles and caches before services start: a protection backup precedes schema migration, and another backup precedes historical text changes when needed. Both are stored in `backups/` under the selected data directory.

Title cleanup preserves paper IDs, GUIDs, classifications, feed associations, translation source snapshots, hashes, and completion times. Backup failure prevents cleanup; a failed cleanup write rolls back the whole transaction.

Requires desktop Obsidian **1.13.0 or later**; update to the latest **1.13.x** before installing or upgrading. The runtime still needs Node.js **22.16+**, `DatabaseSync`, and the SQLite Backup API.

Install only `main.js`, `manifest.json`, and `styles.css` from the release assets.

## 中文

本次更新让连续浏览更紧凑，也让文献状态、兴趣统计和更新时间更易理解。

### 阅读布局

- 翻译、排序、撤回和批量操作与顶部导航一起常驻，滚动长列表时随时可用；顶部按钮和间距更加紧凑。
- 在 **设置 → 文献卡片** 中新增 **根据内容调整卡片高度**。开启后标题自然换行，空字段不占位；文本摘要最多显示三行，摘要图采用限高预览。
- 动态高度默认关闭。保持关闭时，卡片仍根据启用的信息行使用统一高度；关闭作者或文本摘要会减少对应的预留空间。

### 五个文献篮子

| 原名称 | 新名称 | 含义 |
|---|---|---|
| 未读 | 待筛 | 尚未做出判断 |
| 感兴趣 | 关注 | 感兴趣，留待继续阅读 |
| 归档 | 归藏 | 感兴趣，已归档保存 |
| 隐藏 | 略过 | 不感兴趣 |
| 过期 | 过期 | 略过后超过保留期限，仍属不感兴趣 |

已有文献自动使用新名称，原有分类、文献身份与订阅关联保留。

### 统计与时间修复

- 感兴趣率统一为 **（关注 + 归藏）÷（关注 + 归藏 + 略过 + 过期）**，待筛文献不参与计算。略过转为过期后，比例保持一致。
- 例如某订阅有 1 篇归藏、2 篇略过和 17 篇过期，感兴趣率为 **5.0%**。
- 订阅列表的更新时间和顶部“最后更新”摘要统一按系统本地时区显示；SQLite 保存的无时区时间按 UTC 解析。

### 标题与翻译缓存

- 清理 RSS/Atom 标题中的 HTML 标签、字符实体和多余空白，保留标题正文及公式片段。
- 已入库的标题和所有目标语言的缓存标题译文也会修复。仅有标签变化时复用已有译文；原标题内容实际变化后，旧译文不再显示或参与搜索，并在启用标题翻译时重新生成。
- 修复强制重译仍复用成功缓存的问题，并防止旧来源的迟到翻译结果覆盖新任务。
- Corrigendum、Erratum 等勘误保留为独立文献。卡片显示“勘误”标记和短标题，可展开完整原标题及译文；解析时不再把所引原文的年份或正文中的 DOI 当作勘误自身的元数据。

### 升级说明

数据库升级到 **schema 6**。升级后的首次载入会在服务启动前整理历史标题与缓存：schema 迁移前创建保护备份，需要修改历史文本时另建清理前备份，两者均保存在所选数据目录的 `backups/` 中。

标题清理保留文献 ID、GUID、分类、订阅关联，以及翻译来源文本快照、哈希和完成时间。保护备份失败时不执行清理；清理写入失败时整个事务回滚。

需要桌面版 Obsidian **1.13.0 或更高版本**，建议安装或更新前升级到最新的 **1.13.x**。运行环境仍需 Node.js **22.16+**、`DatabaseSync` 和 SQLite Backup API。

只安装发布资源中的 `main.js`、`manifest.json` 和 `styles.css`。
