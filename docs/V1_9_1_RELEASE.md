# Academic RSS Reader v1.9.1

## English

Fixed title translation recovery after HTTP 429 rate limits.

- When the translation service limits requests, remaining titles stay queued so they can be translated later.
- If automatic retries run out, select **Retry translation** to resume the queue. If the rate limit still applies, the plugin shows the remaining wait and resumes when it ends.
- Reopening the reader resumes translation tasks interrupted in the previous session.

## 中文

修复标题翻译遇到 HTTP 429 限流后难以恢复的问题。

- 遇到限流时，后续标题会留在队列中等待，避免接连失败。
- 自动重试用完后，点击 **重试翻译** 即可恢复队列。如果限流等待尚未结束，插件会显示剩余时间，到期后继续翻译。
- 重新打开阅读器时，会恢复上次中断的翻译任务。
