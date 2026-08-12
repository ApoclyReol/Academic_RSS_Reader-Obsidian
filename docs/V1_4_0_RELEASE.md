# Academic RSS Reader v1.4.0

[简体中文](V1_4_0_RELEASE.zh-CN.md) | English

This release makes the reader faster, safer, and more stable:

- Native SQLite with automatic protection backups and in-place v3 upgrades.
- More reliable paper deduplication after upgrading.
- Automatic updates skip feeds refreshed successfully within the last hour;
  manual updates always run.
- Stable two-line card titles with a compact relevance and keyword layout.
- More consistent recommendations, translation caching, and safer LLM/RSS
  handling.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later with Node.js 22.16+ and
> `node:sqlite`. Unsupported runtimes cannot load the database.

> [!IMPORTANT]
> Close other Obsidian instances before upgrading. The plugin automatically
> backs up a v3 database before migration; do not replace the database while
> the plugin is open.

Install only `main.js`, `manifest.json`, and `styles.css` from the GitHub
Release.
