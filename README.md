# RSS Reader for Obsidian

把原有 RSS 阅读器逐步迁移为 Obsidian 原生插件，在 Vault 内完成订阅、阅读、收藏与个性化推荐。

当前版本是迁移阶段的基础框架，已包含：

- TypeScript + esbuild 构建链
- RSS Reader 自定义视图
- Ribbon 入口与命令面板命令
- 基础设置页及持久化
- 面向后续迁移的源码目录边界

## 开发环境

- Node.js 18 或更高版本
- npm
- Obsidian 桌面端
- 用于开发测试的独立 Vault

```bash
npm install
npm run dev
```

开发时，把本目录链接或复制到：

```text
<Vault>/.obsidian/plugins/rss-reader/
```

然后在 Obsidian 的“设置 → 第三方插件”中重新加载并启用 **RSS Reader**。

生产构建：

```bash
npm run build
```

Obsidian 实际加载的发布文件为：

- `main.js`
- `manifest.json`
- `styles.css`

## 目录

```text
src/
├── main.ts                    # 插件生命周期与功能装配
├── constants.ts
├── models/                    # 领域模型和设置类型
├── repositories/              # 本地持久化边界（后续）
├── services/                  # RSS、推荐与业务逻辑（后续）
├── settings/                  # Obsidian 设置页
└── views/                     # Obsidian 工作区视图
```

迁移范围和阶段计划见 [docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md)，开发约定见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
