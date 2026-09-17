# Academic RSS Reader v1.7.1

[简体中文](V1_7_1_RELEASE.zh-CN.md) | English

This is a small maintenance patch:

- Harden database switching, backup, restore, unload, and failure rollback paths.
- Split internal modules and add architecture-boundary checks with focused regression tests.

This patch does not change the SQLite schema or existing data and settings. Requires desktop Obsidian 1.13.0 or later.
