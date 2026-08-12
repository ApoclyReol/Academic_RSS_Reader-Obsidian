# 开发说明

本文只记录开发、测试和发布约束。系统调用关系见[架构设计](ARCHITECTURE.md)，完整表结构、
迁移、备份和恢复规则见[数据库设计](DATABASE.md)，所有文档入口见[文档导航](README.md)。

## 环境与命令

开发工具链使用 Node.js 24。插件运行时另有要求：Obsidian 桌面版内置运行时必须为
Node.js 22.16 或更高版本，并提供 `node:sqlite` 的 `DatabaseSync` 与 SQLite Backup API。
插件不再包含 `sql.js` fallback；不满足要求时应阻止数据库载入并显示升级提示。

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
npm run package
```

- `npm run dev` 持续构建带内联 source map 的 `main.js`。
- `npm run build` 执行 TypeScript 检查并生成压缩后的 `main.js`。
- `build/` 是唯一的构建产物目录，不使用 `dist/` 或 `out/`。
- `npm run package` 先清空旧 `build/`，再将 `main.js`、`manifest.json`、`styles.css` 直接复制到 `build/` 顶层；该目录不保留其他文件或子目录。
- `node:sqlite`、Node `fs` 和 `path` 保持 external，由 Obsidian 桌面运行时提供；发布包不包含 Node 原生实现。

## 模块边界

```text
src/
├── database/       # node:sqlite、schema、串行写入和安全恢复
├── locales/        # 键集合一致的英文与简体中文文案
├── models/         # 领域类型和设置
├── repositories/  # SQL 查询、写入和兼容维护
├── services/       # RSS、翻译、推荐和 LLM
├── settings/       # Obsidian 设置页与 Vault 目录联想
├── types/          # 第三方模块声明
└── views/          # 阅读、订阅管理和兴趣分析
```

约束：

- RSS 解析器只生成领域对象，不调用翻译 Provider。
- Feed Service 先完成 RSS 入库，再通知翻译服务。
- UI 不直接执行 SQL。
- 数据目录先按 Vault 相对路径校验，再通过 `DataAdapter.getFullPath()` 解析；原生文件 API 只接触 SQLite 主文件、WAL/SHM sidecar、incoming/rollback/tmp/previous 文件和 `backups/` 中的数据库备份，其他 Vault 文件继续使用 `DataAdapter`。
- `RssDatabase` 使用 `DatabaseSync`、WAL、`foreign_keys=ON`、`busy_timeout=5000`、`BEGIN IMMEDIATE` 和单一写队列。关闭前必须按 service stop/drain → database drain → database close 的顺序执行。
- 备份使用 SQLite Backup API；恢复使用 incoming/rollback 临时文件和保护快照；替换失败时恢复原库并保留可诊断候选。
- v3 数据库载入时原地升级到 schema 4。升级前使用 `VACUUM INTO` 在 `backups/` 创建保护备份；迁移失败时回滚到原文件。
- 每批订阅更新完成后自动刷新推荐；训练数据 hash 未变化时复用模型并仅增量评分。用户仍可通过按钮主动重建。
- 标题翻译只由阅读页开关触发；译文变化局部更新卡片，不重绘整个列表。
- 插件加载阶段不创建数据库；用户选择 Vault 内数据目录并创建或载入后，才构造 Repository 和业务服务。
- 运行数据库与 `backups/` 固定在用户选择的数据目录，插件目录只保留 Obsidian 管理的设置和发布文件。

详细的组件职责、业务流程、并发和生命周期状态见[架构设计](ARCHITECTURE.md)。本节只保留
开发时必须快速核对的边界。

## 国际化

- 用户文案统一使用稳定语义键和 `t(key, params)`；不得使用中文完整句子作为键或缓存模块级翻译结果。
- `plural()`、`formatNumber()`、`formatDate()` 处理复数、数字和日期。界面语言跟随 Obsidian，与内容翻译目标语言相互独立。
- `npm run check:i18n` 检查语言包键集合、未知键、遗留 `tx()` 和常见 UI API 的硬编码文案，并在 CI 中执行。

## 启动顺序与状态所有权

```text
Plugin.onload
→ 根据 getLanguage() 初始化界面语言
→ 读取 data.json 并迁移旧 SecretStorage 配置
→ 注册 view、commands、ribbon 和 settings
→ 用户首次打开阅读器
→ 检查配置并在后台载入数据库
→ 创建 RssDatabase、RssRepository 和各业务 service
→ 恢复翻译队列并按设置启动订阅更新
```

- `RssReaderPlugin` 拥有当前数据库上下文与 `DatabaseState`，负责创建和释放 services。
- `RssDatabase` 拥有 `DatabaseSync`、串行写链、WAL 处理、备份和恢复。
- `RssRepository` 是唯一 SQL 访问入口。
- `DatabaseOperationCoordinator` 跟踪后台任务，并在切换或恢复数据库时阻止新写入。
- `TranslationService` 拥有翻译队列；数据库恢复后重新载入未完成任务。
- `RssReaderView` 只读取 repository 与调用 services，不持有数据库生命周期。
- 界面语言在插件启动时初始化，所有文案在渲染或操作发生时解析；不得在模块顶层缓存 `t()` 结果。

## 去重与期刊兼容规则

v1.4.0 的稳定身份优先级为：

```text
有 DOI：doi:{规范化 DOI}

无 DOI、有作者：
cnki-local:{sha256(规范化标题|年份|规范化作者前48字符)前24位}

无 DOI、无作者、有出版商稳定 ID：
publisher:{sha256(出版商稳定 ID)前24位}

无 DOI、无作者、无出版商稳定 ID：
cnki-local:{sha256(规范化标题|年份|派生期刊名)前24位}
```

旧 GUID、DOI、出版商稳定 ID、规范化 URL 和标题组合共同参与兼容查找。命中旧记录后保留既有数据库 ID、GUID、阅读状态和更完整的字段，不以新抓取的空值覆盖旧值。ScienceDirect 从 `/pii/<PII>` 提取稳定身份，`dgcid` 作为跟踪参数移除；双方都有 PII 且不同，则禁止通过标题、年份、作者或期刊弱匹配合并。`feeds.journal_name` 是订阅默认期刊名；`items.article_journal` 只保存 RSS 明确提供的文章级覆盖。展示时文章级期刊优先，然后拼接所有关联订阅的去重默认期刊名。修改订阅不会批量改写文章级字段。

## 数据库

旧版六张业务表保持兼容：

- `feeds`
- `items`
- `item_feeds`
- `recommendation_scores`
- `recommendation_keywords`
- `recommendation_models`

v1.0.0 增加：

- `translations`
- `app_metadata`
- `schema_migrations`

新数据库先创建版本 1 基线，再按 `SCHEMA_MIGRATIONS` 顺序升级。每个 migration 在事务中执行并登记；已发布 migration 不得修改或重排。修改 schema 时必须追加新版本并测试旧数据库升级、事务失败、数量校验和恢复。

各表字段、主外键、索引、文献身份、WAL、保护备份和恢复临时文件详见
[数据库设计](DATABASE.md)，不要在本节复制另一套 schema 描述。

## 推荐与订阅后台任务

- 推荐使用统一的 TF-IDF、L2 normalization、类别权重和带截距的稀疏逻辑回归；训练、验证和正式评分必须共享 `vectorizeDocument()`，`FEATURE_VERSION` 变化时旧模型不可复用。训练在内联 Blob Worker 中执行，释放数据库上下文时必须终止 Worker。
- 稀疏维度必须通过循环计算，不得把完整索引数组展开传给 `Math.max()`；评分通过词项到权重索引表遍历实际命中特征，不得逐篇扫描完整词表。
- `Intl.Segmenter` 可用时保留中文词边界；仅为相邻拉丁词生成带空格二元短语。词表排除内置停用词、单文档词、覆盖超过 90% 的词，以及至少出现 10 篇、覆盖超过 50% 且正负出现率差小于 5% 的无区分力词。
- 人工控制仅使用 `is_disabled`：模型替换时删除旧的非停用关键词并保留人工停用项；重新启用后，该词可在后续训练通过自动筛选时重新进入模型。旧数据库的 `manual_direction` / `manual_weight` 字段仅为兼容保留，切换停用状态时会清空，推荐计算不得读取。
- 训练 hash 覆盖文献、标签、人工停用状态、阈值覆盖和特征版本。hash 相同时复用模型并按内容 hash 增量评分；变化时重建词表、IDF 和模型。
- 每批订阅更新完成并写入更新摘要后必须触发一次推荐刷新。刷新失败不得把已成功的订阅更新改记为失败；样本不足状态由推荐模型自身记录。训练 hash 未变化时，此入口只增量评分新增或内容变化的未读文献。
- 分层 80/20 留出验证选择准确率最高的切点，建议阈值为切点上下 10 分；每类少于 5 条时回退 30/70。
- 订阅调度继续使用 `requestUrl()`，限制全局并发 4、同域并发 1，并持久化 ETag、Last-Modified 和健康状态。
- 每次应用启动后首次打开阅读器触发自动更新；`last_success_at` 距当前不足一小时的订阅自动跳过并计数，手动更新不应用该限制。SQLite `CURRENT_TIMESTAMP` 按 UTC 解析；失败退避与近期成功跳过分别统计。
- 429/503 遵循 Retry-After。20 秒超时和取消停止等待、排队、重试、解析及入库；`requestUrl()` 无法中断已发出的底层请求，迟到响应必须忽略。XML 响应上限为 10 MiB，拒绝 `DOCTYPE`，合法空 Feed 可接受。链接只允许 HTTP(S)，只删除已知跟踪参数。
- 翻译缓存键为 `itemId + field + targetLanguage`；失败会删除占位记录，翻译事件带目标语言，阅读器只刷新对应卡片。
- LLM 只允许 HTTPS 或本机 HTTP，30 秒超时，网络错误/429/5xx 最多重试两次；标题、摘要和用户兴趣按不可信数据传入严格 system policy，并只接受 `high`/`low`。

## 测试 Vault

只在独立 Vault 中验收开发版本：

1. 冷启动、禁用/启用和应用重载。
2. RSS/Atom、CNKI、DOI、动态链接和旧 GUID 去重。
3. 五篮子状态流转和撤回。
4. 标题翻译开关、视口预取、缓存和失败回退。
5. 订阅开关、单个更新和批量导入。
6. 未配置引导、创建、载入、目录切换、保护备份、恢复、损坏文件保留和外键检查。
7. 稀疏推荐、阈值校准、增量评分、LLM 严格响应和兴趣分析。
8. 中文语言环境显示完整简体中文界面；英文及其他语言环境显示完整英文界面。
9. 分别检查设置、阅读器、命令、通知、动态进度、错误、确认框和 ARIA 文案，确认语言一致且没有未翻译文本。
10. 条件订阅请求、304、全局/同域并发、Retry-After、超时、取消和自动退避。

正式版本发布前，应在 Windows 和 macOS 桌面环境分别执行上述功能测试，并在对应版本发布说明中记录平台验证结果。

## Obsidian 兼容性

- v1.4.0 使用 `PluginSettingTab.getSettingDefinitions()`，最低支持 Obsidian 1.13.0。
- 安装或更新前，用户必须先将 Obsidian 更新到最新可用的桌面版本，并确认其内置 Node.js 满足 `node:sqlite` 运行时检查。
- 数据目录、SecretStorage、数据库操作和动态状态使用声明式设置中的 `render` 保留；简单字段使用 `control`。
- 不再保留 `display()` / `redisplay()` 兼容分支，避免两套设置实现发生漂移。

## 发布

版本必须同时更新：

- `package.json`
- `package-lock.json`
- `manifest.json`
- `versions.json`
- RSS 请求 User-Agent
- `README.md`、`README.zh-CN.md`、`CHANGELOG.md` 和对应版本发布说明

本地构建目录固定为：

```text
build/
├── main.js
├── manifest.json
└── styles.css
```

`npm run package` 每次都先清空 `build/`，不得生成 ZIP、`SHA256SUMS.txt`、插件子目录或其他产物。GitHub Release 标签与 `manifest.json` 完全相同且不带 `v`。推送版本标签后，`.github/workflows/release.yml` 使用 Node.js 24，重新执行 lint、i18n 检查、测试、构建和 package，扫描最终 bundle 后为 `build/main.js`、`build/manifest.json`、`build/styles.css` 生成 artifact attestations，并只将这三个受支持文件上传到 GitHub Release。

下载后可验证来源：

```bash
gh attestation verify main.js -R ApoclyReol/rss_reader-obsidian
```
