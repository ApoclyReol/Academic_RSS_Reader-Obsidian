# Academic RSS Reader v1.6.3

[简体中文](V1_6_3_RELEASE.zh-CN.md) | English

This patch adds a small navigation improvement for long reading baskets.

## Highlights

- Every basket shows a **Back to top** button below the list after all papers
  have finished loading.
- The action returns the current reader scroll container to the top and is
  keyboard and touch accessible in both supported UI languages.

This patch does not change the SQLite schema, settings, or existing data.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later. Install only `main.js`,
> `manifest.json`, and `styles.css` from the GitHub Release.
