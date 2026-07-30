export type UiLanguage = "en" | "zh";

let uiLanguage: UiLanguage = "zh";

const ENGLISH: Readonly<Record<string, string>> = {
  "Academic RSS Reader 仅支持桌面端": "Academic RSS Reader is available on desktop only.",
  "打开 academic RSS reader": "Open Academic RSS Reader",
  "打开阅读器": "Open reader",
  "更新全部启用订阅": "Update all enabled feeds",
  "手动更新": "Manual update",
  "Academic RSS Reader 已将旧 LLM API Key 迁移到 Obsidian SecretStorage，并从 data.json 删除明文。":
    "Academic RSS Reader moved the legacy LLM API key to SecretStorage and removed the plaintext value from data.json.",
  "数据库已在运行；请使用“切换数据目录”":
    "A database is already running. Use the data directory switch controls.",
  "所选目录已存在 rss-reader.sqlite3，请使用载入":
    "The selected directory already contains rss-reader.sqlite3. Load it instead.",
  "所选目录中没有 rss-reader.sqlite3":
    "The selected directory does not contain rss-reader.sqlite3.",
  "数据库仍有保存任务正在进行":
    "The database still has a save operation in progress.",
  "临时数据库快照校验失败":
    "The temporary database snapshot failed validation.",
  "保存后的数据库校验失败":
    "The saved database failed validation.",
  "恢复后的数据库校验失败":
    "The restored database failed validation.",
  "所选目录就是当前数据目录":
    "The selected directory is already the current data directory.",
  "所选目录指向当前数据目录":
    "The selected directory points to the current data directory.",
  "目标目录已存在 rss-reader.sqlite3，迁移不会覆盖它":
    "The target directory already contains rss-reader.sqlite3. Migration will not overwrite it.",
  "目标目录中没有可载入的 rss-reader.sqlite3":
    "The target directory does not contain a valid rss-reader.sqlite3 to load.",
  "迁移后的数据库校验失败": "The migrated database failed validation.",
  "请先配置并载入数据库": "Configure and load a database first.",
  "当前数据目录的 backups 中没有有效数据库备份":
    "No valid database backup was found in the current data directory's backups folder.",
  "启动时自动更新": "Automatic startup update",
  "无法获取 Obsidian 工作区窗口":
    "Could not access the workspace window.",
  "请先在 Academic RSS Reader 设置中选择并载入数据目录":
    "Select and load a data directory in the Academic RSS Reader settings first.",
  "请先在 academic RSS reader 设置中选择并载入数据目录":
    "Select and load a data directory in the Academic RSS Reader settings first.",
  "数据库存储": "Database storage",
  "请选择当前 vault 内的数据目录。运行数据库保存为 ":
    "Choose a data directory inside the current vault. The active database is stored as ",
  "，所有保护性备份保存在 backups 子目录。":
    ", and all protective backups are stored in the backups subdirectory.",
  "Academic RSS reader 数据目录": "Academic RSS Reader data directory",
  "输入相对于 vault 根目录的路径；输入本身不会创建或载入数据库。":
    "Enter a path relative to the vault root. Entering a path does not create or load a database.",
  "迁移当前库": "Migrate current database",
  "载入目标库": "Load target database",
  "创建新数据库": "Create new database",
  "载入数据库": "Load database",
  "已有有效数据库时使用载入；没有数据库时使用创建。切换和迁移不会覆盖目标文件。":
    "Load an existing valid database or create one when none exists. Switching and migration never overwrite the target file.",
  "当前正在使用": "Currently in use",
  "数据库保护": "Database protection",
  "备份文件保存在当前数据目录的 backups 子目录。":
    "Backups are stored in the backups subdirectory of the current data directory.",
  "立即备份": "Back up now",
  "恢复最近备份": "Restore latest backup",
  "订阅更新": "Feed updates",
  "打开阅读器时自动更新": "Update automatically when opening the reader",
  "每次启动 Obsidian 后，首次打开 academic RSS reader 时在后台静默更新全部启用订阅。":
    "After each app launch, silently update all enabled feeds in the background the first time the reader is opened.",
  "隐藏过期天数": "Days before hidden items expire",
  "隐藏条目超过此天数后，在下一次订阅更新时转为已过期。":
    "Hidden items older than this many days become expired during the next feed update.",
  "实验性网页翻译": "Experimental web translation",
  "使用 Google 非正式免密网页接口。接口可能限流或失效，译文不保证专业术语准确，不应用于正式引用。文本由本机直接发送，不经过开发者服务器。":
    "Uses an unofficial Google web endpoint without authentication. It may be rate-limited or stop working, and translations may be unsuitable for technical terms or formal citation. Text is sent directly from your device and never passes through the developer's server.",
  "目标语言": "Target language",
  "默认并推荐简体中文。": "Simplified Chinese is the default and recommended target.",
  "简体中文": "Simplified Chinese",
  "LLM 推荐复核": "LLM recommendation review",
  "API 地址": "API endpoint",
  "选择或创建 Obsidian SecretStorage 条目；data.json 只保存条目名称。":
    "Select or create a SecretStorage entry. data.json stores only the entry name.",
  "模型": "Model",
  "研究兴趣补充描述": "Additional research interests",
  "测试连接": "Test connection",
  "测试": "Test",
  "数据库已就绪。输入其他目录后可迁移当前库或载入目标库。":
    "The database is ready. Enter another directory to migrate the current database or load the target database.",
  "正在初始化数据库……": "Initializing database…",
  "未知错误": "Unknown error",
  "已保存数据目录；打开 Academic RSS Reader 时会尝试载入其中的数据库。":
    "The data directory is saved. Academic RSS Reader will try to load its database when opened.",
  "尚未配置数据目录。": "No data directory is configured.",
  "请输入当前 Vault 内的数据目录。":
    "Enter a data directory inside the current vault.",
  "目录中没有数据库，可以创建新数据库。":
    "This directory has no database. You can create a new one.",
  "发现有效的 rss-reader.sqlite3，可以载入。":
    "A valid rss-reader.sqlite3 was found and can be loaded.",
  "数据库操作完成": "Database operation completed.",
  "未读": "Unread",
  "感兴趣": "Interested",
  "归档": "Archived",
  "已隐藏": "Hidden",
  "已过期": "Expired",
  "文献阅读": "Reader",
  "订阅管理": "Feeds",
  "兴趣分析": "Interest analysis",
  "需要配置数据目录": "A data directory is required",
  "正在载入 Academic RSS Reader 数据库……":
    "Loading the Academic RSS Reader database…",
  "Academic RSS Reader 不会在插件目录创建数据库。请先到设置中选择当前 Vault 内的数据目录，然后创建或载入数据库。":
    "Academic RSS Reader does not create a database in the plugin directory. Choose a data directory inside the current vault in settings, then create or load a database.",
  "打开 academic RSS reader 设置": "Open Academic RSS Reader settings",
  "刷新": "Refresh",
  "撤回": "Undo",
  "显示原文": "Show original",
  "翻译标题": "Translate titles",
  "这个篮子里当前没有文献。": "There are no papers in this basket.",
  "打开原文": "Open original",
  "已加载全部文献": "All papers loaded",
  "继续向下滚动以加载更多": "Scroll down to load more",
  "正在加载更多文献……": "Loading more papers…",
  "翻译失败": "Translation failed",
  "等待翻译……": "Waiting for translation…",
  "正在翻译……": "Translating…",
  "高相关": "High relevance",
  "低相关": "Low relevance",
  "待判断": "Pending",
  "个性化推荐": "Personalized recommendations",
  "未评分": "Unscored",
  "更新关键词推荐": "Update keyword recommendations",
  "正在准备更新关键词推荐……":
    "Preparing to update keyword recommendations…",
  "LLM 复核待判断": "Review pending items with LLM",
  "正在复核待判断论文……": "Reviewing pending papers…",
  "关键词词表": "Keyword list",
  "添加订阅": "Add feed",
  "批量导入": "Bulk import",
  "更新全部启用": "Update all enabled",
  "还没有订阅源。": "No feeds yet.",
  "名称": "Name",
  "启用": "Enabled",
  "条目": "Items",
  "最后检查": "Last checked",
  "错误": "Error",
  "操作": "Actions",
  "停用订阅": "Disable feed",
  "启用订阅": "Enable feed",
  "尚未更新": "Never updated",
  "编辑": "Edit",
  "更新": "Update",
  "删除": "Delete",
  "总条目": "Total items",
  "隐藏": "Hide",
  "过期": "Expired",
  "期刊": "Journal",
  "感兴趣率": "Interest rate",
  "是": "Yes",
  "否": "No",
  "正在更新订阅……": "Updating feeds…",
  "启用实验性标题翻译？": "Enable experimental title translation?",
  "启用后，当前视口中的文献标题及后续预取标题会直接发送给 Google 非正式网页翻译接口。请求不经过开发者服务器；该接口可能限流、失效，译文不应用于正式引用。":
    "When enabled, titles in the current viewport and prefetched titles are sent directly to an unofficial Google web translation endpoint. Requests never pass through the developer's server. The endpoint may be rate-limited or stop working, and translations should not be used for formal citation.",
  "取消": "Cancel",
  "同意并启用": "Agree and enable",
  "编辑订阅": "Edit feed",
  "订阅名称": "Feed name",
  "保存": "Save",
  "批量导入订阅": "Bulk import feeds",
  "支持 opml、XML、txt、粘贴内容或逐行 URL。重复 URL 会跳过。":
    "Supports OPML, XML, TXT, pasted content, or one URL per line. Duplicate URLs are skipped.",
  "粘贴 opml 或 RSS URL": "Paste OPML or RSS URLs",
  "预览": "Preview",
  "导入": "Import",
  "推荐关键词词表": "Recommendation keywords",
  "关键词": "Keyword",
  "方向": "Direction",
  "权重": "Weight",
  "正样本": "Positive samples",
  "负样本": "Negative samples",
  "状态": "Status",
  "正向": "Positive",
  "负向": "Negative",
  "已禁用": "Disabled",
  "人工": "Manual",
  "自动": "Automatic",
  "人工方向": "Manual direction",
  "人工权重": "Manual weight",
  "禁用": "Disable",
  "保存修正": "Save override",
  "请输入关键词": "Enter a keyword.",
  "恢复自动权重": "Restore automatic weight",
  "请确认": "Confirm",
  "确认": "Confirm",
  "恢复未读": "Restore to unread",
  "恢复兴趣": "Restore to interested",
  "订阅名称不能为空": "Feed name cannot be empty.",
  "RSS URL 必须是有效的 http/https 链接":
    "The RSS URL must be a valid HTTP or HTTPS URL.",
  "已有订阅更新正在进行": "A feed update is already in progress.",
  "订阅不存在": "Feed not found.",
  "订阅获取失败": "Failed to fetch feed.",
  "正在读取推荐训练样本……": "Reading recommendation training samples…",
  "训练样本不足：正样本和负样本均至少需要 2 篇":
    "Not enough training samples. At least two positive and two negative papers are required.",
  "正在提取关键词特征……": "Extracting keyword features…",
  "关键词模型无法训练：没有足够的重复词汇":
    "The keyword model cannot be trained because there are not enough recurring terms.",
  "正在训练关键词模型……": "Training keyword model…",
  "正在为未读文献评分……": "Scoring unread papers…",
  "正在保存推荐结果……": "Saving recommendation results…",
  "只回复 high，不要添加其他文字。":
    "Reply with high only. Do not add any other text.",
  "服务已响应，但没有按要求返回 high":
    "The service responded but did not return high as requested.",
  "连接、认证和模型响应正常":
    "Connection, authentication, and model response are working.",
  "你正在帮助研究者筛选论文。":
    "You are helping a researcher screen papers.",
  "未补充": "Not provided",
  "判断论文是否值得优先阅读。只能返回 high 或 low。":
    "Decide whether this paper deserves priority reading. Return high or low only.",
  "请先配置 LLM 地址、API Key 和模型":
    "Configure the LLM endpoint, API key, and model first.",
  "LLM 返回内容为空": "The LLM returned an empty response.",
  "LLM 必须严格返回 high 或 low":
    "The LLM must return exactly high or low.",
  "翻译服务返回了无法识别的数据":
    "The translation service returned unrecognized data.",
  "翻译结果为空": "The translation result is empty.",
  "数据库正在切换或恢复，请稍后再试":
    "The database is being switched or restored. Try again shortly.",
  "后台任务正在执行，请等待任务完成后再切换或恢复数据库":
    "A background task is running. Wait for it to finish before switching or restoring the database.",
  "请选择当前 Vault 内的相对目录":
    "Choose a relative directory inside the current vault.",
  "数据目录必须位于当前 Vault 内":
    "The data directory must be inside the current vault.",
  "数据库尚未初始化": "The database has not been initialized.",
};

export function getUiLanguage(language?: string): UiLanguage {
  if (language === undefined) {
    return uiLanguage;
  }
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function setUiLanguage(language: string): void {
  uiLanguage = getUiLanguage(language);
}

export function t(chinese: string): string {
  if (getUiLanguage() === "zh") {
    return chinese;
  }
  return ENGLISH[chinese] ?? chinese;
}

export function tx(chinese: string, english: string): string {
  return getUiLanguage() === "zh" ? chinese : english;
}

export function hasEnglishTranslation(chinese: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENGLISH, chinese);
}
