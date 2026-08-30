# Academic RSS Reader v1.6.2

[简体中文](V1_6_2_RELEASE.zh-CN.md) | English

This patch streamlines high-volume paper triage and keeps card actions aligned.

## Highlights

- The unread basket can hide every remaining unread paper in one confirmed
  action after you mark the papers you want to keep. The full batch can be
  restored with **Undo**.
- Every basket can now be sorted by title, last-seen update time, journal, or
  relevance.
- Card actions now start at the left edge, followed by relevance and keyword
  evidence. Buttons stay aligned across baskets, and long keywords no longer
  cover the action area.

This patch does not change the SQLite schema or existing settings and data.

> [!IMPORTANT]
> Requires desktop Obsidian 1.13.0 or later. Install only `main.js`,
> `manifest.json`, and `styles.css` from the GitHub Release.
