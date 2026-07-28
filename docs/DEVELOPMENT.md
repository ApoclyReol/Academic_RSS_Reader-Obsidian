# 开发说明

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run lint
```

`npm run dev` 会监听 `src/` 并生成开发版 `main.js`；`npm run build` 会先做 TypeScript 类型检查，再生成压缩后的生产版本。

## 在测试 Vault 中加载

建议只使用独立测试 Vault：

1. 关闭或禁用同名插件。
2. 将项目目录链接到 `<Vault>/.obsidian/plugins/rss-reader/`，或复制 `main.js`、`manifest.json`、`styles.css`。
3. 打开“设置 → 第三方插件”，启用 RSS Reader。
4. 修改代码后运行命令“重新加载应用而不保存”，再检查控制台错误。

## 代码边界

- `main.ts` 只负责插件生命周期、命令注册和依赖装配。
- `views/` 负责界面，不直接实现抓取或推荐算法。
- `services/` 承载用例和业务逻辑，不依赖具体视图。
- `repositories/` 封装持久化，避免业务层绑定 Obsidian 存储细节。
- `models/` 存放跨层共享的领域类型。

后续功能应按垂直切片迁移，并为 service 与 repository 层补充自动化测试。

## 版本发布

```bash
npm version patch
npm run build
```

版本命令会同步 `package.json`、`manifest.json` 和 `versions.json`。GitHub Release 的标签必须与 `manifest.json` 中版本一致，且不带 `v` 前缀。
