# Academic RSS Reader v1.0.3

v1.0.3 是以稳定性、启动体验和界面反馈为主的小型修复版本。数据库 schema 仍为版本 1，最低 Obsidian 版本仍为 1.11.4。

## 启动与数据库生命周期

- 已打开的 RSS 窗口随工作区恢复时会立即渲染载入状态，不再等待数据库初始化或订阅网络请求完成。
- 数据库载入成功后统一刷新所有 RSS 窗口；路径失效、配置异常或数据库校验失败时显示设置引导，不阻止 Obsidian 主界面启动。
- 启动时自动更新在后台执行，并通过消息通知显示开始、完成或失败状态。
- 数据库切换和恢复会拒绝正在执行的订阅更新、翻译、LLM 复核、推荐重建及数据库写入，避免旧服务写入已关闭的数据库。
- 恢复备份后，`pending` 和 `translating` 翻译任务会重新进入队列，`failed` 任务保持失败状态。

## 阅读与推荐

- 文献列表首次加载 100 条，滚动到底部后继续追加下一批 100 条。
- 文献篮子的名称和数量改为单行布局，保留足够的触摸区域。
- 文献标题后显示“高相关”“待判断”或“低相关”彩色小字，其中低相关使用灰色。
- 排序按最终推荐分层、关键词得分和发布日期依次执行。
- 关键词模型的特征提取、350 轮训练和未读评分会分批让出 UI 主线程，并显示阶段通知。
- 推荐结果使用 SQLite prepared statement 批量写入，缩短最终提交停顿；提交仍保持原子性。

## 安全、兼容与质量

- Vault 路径使用真实路径和最近已存在父目录校验，拒绝指向 Vault 外部的 symlink。
- UI 异步操作统一捕获异常并防止重复提交，导入和确认失败时不再产生未处理的 Promise rejection。
- 增加 `:focus-visible`、ARIA 当前与按压状态、`aria-live`、错误提示和 44×44px 触摸尺寸。
- DOM 类型判断、观察器、定时器和外部链接使用视图所属窗口，支持 Obsidian popout。
- 清理无效翻译设置和不可达逻辑，继续使用兼容旧版 Obsidian 的 `PluginSettingTab.display()`。
- 新增数据库生命周期、翻译状态、Vault 路径、异步 UI、连续加载和 popout DOM 测试，并增加 Node.js 20 GitHub Actions。

## 发布产物

```text
build/
├── obsidian/academic-rss-reader/
│   ├── main.js
│   ├── manifest.json
│   └── styles.css
├── Academic-RSS-Reader-1.0.3.zip
└── SHA256SUMS.txt
```
