# Academic RSS Reader v1.3.0

## Important compatibility requirement

Academic RSS Reader v1.3.0 requires Obsidian 1.13.0 or later. Before installing or updating to this release, update Obsidian to the latest available 1.13.x release.

This release does not support Obsidian 1.11.x or 1.12.x. Users who cannot update should remain on v1.2.0.

## Declarative settings

- The settings tab now uses Obsidian's declarative `getSettingDefinitions()` API.
- Plugin settings can appear in Obsidian's settings search.
- Simple values use declarative controls with validation and normalized persistence.
- The data-directory picker, Vault-relative path validation, SecretStorage selector, database operations, backups, restore actions, and dynamic database status remain available through custom setting renderers.

## Data compatibility

- Existing SQLite databases require no migration.
- Existing `data.json` settings require no migration.
- LLM API keys remain in Obsidian SecretStorage; the plugin continues to store only the secret entry name in `data.json`.
- Database lifecycle, protective snapshots, recovery candidates, and Vault path boundaries are unchanged.

## Verification

- Declarative setting definitions and normalized control persistence are covered by tests.
- Existing lifecycle, Vault path, i18n, database, feed, recommendation, parser, and translation tests remain passing.
- The release package contains `main.js`, `manifest.json`, and `styles.css`.
