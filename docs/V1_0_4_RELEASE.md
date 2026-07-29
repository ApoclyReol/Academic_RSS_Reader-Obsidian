# Academic RSS Reader v1.0.4

v1.0.4 focuses on community-plugin review compliance and release provenance. The database schema remains version 1 and the minimum supported app version remains 1.11.4.

## Vault file access

- Runtime database creation, loading, persistence, migration, backup, inspection, and restore now use the Vault `DataAdapter`.
- Database and backup paths remain relative to the user-selected directory inside the current Vault.
- Absolute paths and `..` traversal are rejected before any file operation.
- Database writes continue to use a temporary file and protected replacement. A failed replacement restores the previous file.
- The plugin still does not create or open a database during startup.

## Manifest and documentation

- The manifest description is now English, omits the redundant product name, and ends with punctuation.
- The main README is a complete English guide.
- The Chinese guide is preserved in `README.zh-CN.md` with reciprocal language links.

## Release provenance

- Version tags trigger a dedicated GitHub Actions release workflow.
- The tag must exactly match `manifest.json`.
- Lint, tests, type-checking, and the production build run before release.
- GitHub artifact attestations are generated for `main.js`, `manifest.json`, and `styles.css`.
- GitHub Releases contain only those three supported assets.
- The local package command may still create a ZIP and `SHA256SUMS.txt` for manual installation and local verification; they are not uploaded as release assets.

Verify a downloaded asset with:

```bash
gh attestation verify main.js -R ApoclyReol/rss_reader-obsidian
```
