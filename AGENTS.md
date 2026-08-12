# Academic RSS Reader Agent Guide

## 事实源

- 当前代码、配置、测试和 Git 状态优先于历史发布说明与外部记忆。
- 插件元数据以 `manifest.json` 为准；npm 版本同步到 `package.json` 和 `package-lock.json`；兼容版本登记在 `versions.json`。
- 数据库 schema 以 `src/database/schema.ts` 为准，设置默认值以 `src/models/settings.ts` 为准。
- 用户文档入口是 `README.md` 和 `README.zh-CN.md`，开发约束见 `docs/DEVELOPMENT.md`。
- 维护文档入口是 `docs/README.md`；架构事实见 `docs/ARCHITECTURE.md`，数据库设计见 `docs/DATABASE.md`。

## 模块与所有权

- `src/main.ts`：插件生命周期、语言初始化、数据库上下文和服务装配。
- `src/database/`：`node:sqlite` 初始化、schema、串行写入、WAL、备份和恢复。
- `src/repositories/`：唯一 SQL 访问层；UI 和 services 不直接执行 SQL。
- `src/services/`：订阅、翻译、推荐、LLM 和数据库操作协调。
- `src/settings/`：设置页与 Vault 目录联想。
- `src/views/`：阅读器、订阅管理、兴趣分析和纯 UI helper。
- `src/i18n.ts`：界面语言状态、英文词典和动态文案选择。

## 不可破坏的约束

- 插件加载阶段不得创建或打开数据库；仅在用户打开阅读器并明确配置数据目录后载入。
- 运行数据库和 `backups/` 必须位于用户选择的 Vault 相对目录；拒绝绝对路径、空路径和 `..` 越界。
- 数据目录先使用 Vault 相对路径校验，再通过 `DataAdapter.getFullPath()` 解析；原生 `fs/path` 只允许用于 SQLite 主文件、WAL/SHM sidecar、受控临时/恢复/备份文件，不得通过 `adapter.basePath` 扩大范围。
- 数据库替换必须使用临时文件和上一版本保护文件；失败时恢复原文件，不创建独立恢复库。
- 不重新引入旧插件目录扫描、旧数据库自动导入或启动时恢复库。
- 所有数据库写入由同一协调器和写链保护；切换或恢复数据库时不得让后台任务写入旧上下文。
- UI 文案统一通过 `t()` / `tx()` 输出。不得在模块顶层调用并缓存翻译结果；语言初始化后在渲染或操作发生时解析文案。
- 内容翻译目标语言与界面语言相互独立。
- v1.4 schema 使用 `feeds.journal_name` 作为订阅默认期刊，`items.article_journal` 作为 RSS 文章级覆盖；旧 v3 库必须先保护备份再原地迁移。
- 运行时必须检查 Node.js 22.16+、`DatabaseSync` 与 SQLite Backup API；不支持时阻止载入，不提供 `sql.js` fallback。

## 验证

修改后至少运行：

```bash
npm run lint -- --max-warnings=0
npm test
npm run package
git diff --check
```

- 数据库、生命周期、路径、翻译、推荐和本地化行为应增加对应测试。
- 构建产物目录统一为 `build/`，不得再使用或创建 `dist/`、`out/` 等并行产物目录。
- `npm run package` 必须先清空 `build/`，再将 `main.js`、`manifest.json`、`styles.css` 直接复制到其中；不得生成 ZIP、校验文件、插件子目录或其他产物。
- 发布前检查 `build/` 顶层只包含 `main.js`、`manifest.json`、`styles.css`。
- 扫描最终 `main.js`，确认依赖没有重新打入 Node `fs` / `path` 分支。
- 桌面正式版本应在 Windows 和 macOS 验收，并检查中文界面与英文回退。

## 版本与发布

- 版本同步：`package.json`、`package-lock.json`、`manifest.json`、`versions.json`、RSS User-Agent、Changelog、README 和版本发布说明。
- 正式 tag 与 manifest 完全一致，格式为 `x.y.z`，不带 `v`。
- GitHub Release 只上传 `main.js`、`manifest.json`、`styles.css`；本地构建同样不生成 ZIP 或 `SHA256SUMS.txt`。
- 发布工作流必须先通过 lint、测试和生产构建，再生成三个资源的 artifact attestations。
- 发布后核对 workflow、tag 指向、资源清单和每个资源的 attestation 记录。

- v1.3.0 起最低支持 Obsidian 1.13.0，设置页使用 `getSettingDefinitions()`；安装或更新前要求用户使用最新的 1.13.x 版本。
- 数据目录、SecretStorage、数据库操作和动态数据库状态通过声明式设置的 `render` 保留，简单字段使用 `control`。
- CI 与 Release 工作流使用 Node.js 24、`actions/checkout@v6` 和 `actions/setup-node@v6`；修改后必须复核构建、发布资源、bundle 外部依赖和 artifact attestations。该事项不改变插件运行时兼容范围。

## 临时交接

仅在存在未完成的跨会话工作时创建 `HANDOFF.md`。任务完成后删除该文件，并把长期规则合并回本文件。
