# Academic RSS Reader v1.9.0

## English

Title translation now supports your own LLM service, alongside the existing Google web translator.

- Choose **Google web translation** or **LLM translation** in **Settings → Title translation**. Google remains the default, and the reader’s **Translate titles / Show original** button works as before.
- Configure an OpenAI-compatible endpoint, API key, model, and translation prompt independently of recommendation review. A short default prompt is included; leave the prompt blank to restore it.
- Use **Test translation** to preview a fixed sample title with the selected service before loading a database.
- Existing translations continue to be reused when switching services, models, or prompts. To replace them, use **Clear title translation cache** in settings, then click **Translate titles** again. Clearing covers all target languages while preserving original titles, reading states, and abstract translations.
- Fix missing hover, pressed, and keyboard-focus feedback on modal buttons, and simplify the translation settings descriptions.

## 中文

标题翻译新增自定义 LLM 服务，同时保留现有 Google 网页翻译。

- 在 **设置 → 标题翻译** 中选择 **Google 网页翻译** 或 **LLM 翻译**。默认仍使用 Google，阅读器原有的“翻译标题 / 显示原文”按钮保持不变。
- LLM 翻译可独立配置 OpenAI 兼容接口地址、API Key、模型和翻译提示词，与推荐复核配置分开。内置简短默认提示词，留空即可恢复默认。
- 新增“测试翻译”，可使用所选服务预览一条固定示例标题，无需先载入数据库。
- 切换服务、模型或提示词后继续复用已有译文。需要替换时，在设置中“清理标题翻译缓存”，再点击“翻译标题”即可。清理覆盖全部目标语言，保留原标题、阅读状态和摘要译文。
- 修复弹窗按钮缺少悬停、按下和键盘焦点反馈的问题，并精简翻译设置中的说明文字。
