# 开发说明

## 环境与命令

需要 Node.js 18 或更高版本。

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
- `npm run package` 先清空旧 `build/`，再生成完整插件目录、版本化 ZIP 和 SHA-256 校验文件。
- SQLite ASM 运行时内嵌在 `main.js`，发布包不需要 WASM 文件。

## 模块边界

```text
src/
├── database/       # sql.js、schema、串行事务和原子持久化
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
- 所有运行时文件操作使用 Obsidian Vault `DataAdapter` 和 Vault 相对路径。
- 所有数据库写入经同一写链和事务，提交后以临时文件保护替换；替换失败时恢复上一文件。
- 推荐模型只在用户主动操作时重建。
- 标题翻译只由阅读页开关触发；译文变化局部更新卡片，不重绘整个列表。
- 插件加载阶段不创建数据库；用户选择 Vault 内数据目录并创建或载入后，才构造 Repository 和业务服务。
- 运行数据库与 `backups/` 固定在用户选择的数据目录，插件目录只保留 Obsidian 管理的设置和发布文件。

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
- `RssDatabase` 拥有 sql.js 实例、串行写链和二进制持久化。
- `RssRepository` 是唯一 SQL 访问入口。
- `DatabaseOperationCoordinator` 跟踪后台任务，并在切换或恢复数据库时阻止新写入。
- `TranslationService` 拥有翻译队列；数据库恢复后重新载入未完成任务。
- `RssReaderView` 只读取 repository 与调用 services，不持有数据库生命周期。
- 界面语言在插件启动时初始化，所有文案在渲染或操作发生时解析；不得在模块顶层缓存 `t()` 结果。

## 去重兼容规则

v1.0.0 必须保持旧 Streamlit 身份规则：

```text
有 DOI：
doi:{lowercase-doi}

无 DOI、有作者：
cnki-local:{sha256(规范化标题|年份|规范化作者前48字符)前24位}

无 DOI、无作者：
cnki-local:{sha256(规范化标题|年份|规范化用户期刊名)前24位}
```

不得把 CNKI 临时 URL 参数用于 GUID。用户填写的订阅名称是期刊名真源。任何 GUID、标题规范化或作者提取调整都必须增加兼容测试，并用旧数据库差集验证。

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

修改 schema 时必须增加明确迁移、保持重复执行幂等，并测试事务失败、数量校验和恢复。

## 测试 Vault

只在独立 Vault 中验收开发版本：

1. 冷启动、禁用/启用和应用重载。
2. RSS/Atom、CNKI、DOI、动态链接和旧 GUID 去重。
3. 五篮子状态流转和撤回。
4. 标题翻译开关、视口预取、缓存和失败回退。
5. 订阅开关、单个更新和批量导入。
6. 未配置引导、创建、载入、目录切换、保护备份、恢复、损坏文件保留和外键检查。
7. 推荐、LLM 严格响应和兴趣分析。
8. 中文语言环境显示完整简体中文界面；英文及其他语言环境显示完整英文界面。
9. 分别检查设置、阅读器、命令、通知、动态进度、错误、确认框和 ARIA 文案，确认语言一致且没有未翻译文本。

正式版本发布前，应在 Windows 和 macOS 桌面环境分别执行上述功能测试，并在对应版本发布说明中记录平台验证结果。

## 延期事项

- 在最低支持版本仍为 Obsidian 1.11.4 时保留 `PluginSettingTab.display()`。
- 正式采用 Obsidian 1.13 后，提高 `minAppVersion`，迁移到 `getSettingDefinitions()`，删除 `display()` / `redisplay()`。
- 迁移时验证设置搜索、动态数据库状态、Vault 目录联想、SecretStorage 和操作按钮。

## 发布

版本必须同时更新：

- `package.json`
- `package-lock.json`
- `manifest.json`
- `versions.json`
- RSS 请求 User-Agent
- `README.md`、`README.zh-CN.md`、`CHANGELOG.md` 和对应版本发布说明

发布 ZIP 中只能有：

```text
academic-rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

GitHub Release 标签与 `manifest.json` 完全相同且不带 `v`。推送版本标签后，`.github/workflows/release.yml` 会重新执行 lint、测试和构建，为 `main.js`、`manifest.json`、`styles.css` 生成 artifact attestations，并只将这三个受支持文件上传到 GitHub Release。版本化 ZIP 和 `SHA256SUMS.txt` 只作为本地手动安装与校验产物，不上传到 Release。

下载后可验证来源：

```bash
gh attestation verify main.js -R ApoclyReol/rss_reader-obsidian
```
