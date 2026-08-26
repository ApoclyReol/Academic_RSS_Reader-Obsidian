# Academic RSS Reader v1.6.1

[简体中文](V1_6_1_RELEASE.zh-CN.md) | English

This patch improves translation resilience and keeps card actions stable while
adding more content-language choices.

## Highlights

- Translation requests now have a 15-second timeout and bounded retry backoff
  (15 seconds, 1 minute, and 5 minutes). Network, rate-limit, and server
  failures are retried only within the three-attempt budget; repeated failures
  stop automatically and keep a failed task for manual retry.
- The reader shows a **Retry translation** action after a title translation
  reaches the retry limit. Original titles remain available, and a retry does
  not reset the reader's scroll position.
- Translation settings now include Simplified Chinese, Traditional Chinese,
  English, Japanese, Korean, French, German, Spanish, Portuguese, Italian,
  and Russian. Each option also shows its target language code, while source
  language remains automatically detected for mixed feeds.
- Card actions use a fixed relevance column and action column. Long or short
  recommendation keywords no longer move the action buttons horizontally.

This patch does not change the SQLite schema, RSS parsing, recommendation
features, or the card field switches introduced in v1.6.0.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later. Install only `main.js`,
> `manifest.json`, and `styles.css` from the GitHub Release.
