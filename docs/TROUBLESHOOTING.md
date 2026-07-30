# Troubleshooting

[简体中文](TROUBLESHOOTING.zh-CN.md)

## The reader asks for a data directory

Open **Settings → Academic RSS Reader**, enter a directory relative to the current Vault, then:

- Choose **Load database** when the directory already contains a valid `rss-reader.sqlite3`.
- Choose **Create new database** only when the directory does not contain a database.

Absolute paths and paths containing `..` are rejected. The plugin does not create a database during startup.

## The database cannot be loaded

The original file is kept unchanged when validation fails.

1. Confirm that the selected directory is inside the current Vault.
2. Confirm that `rss-reader.sqlite3` exists in that directory.
3. Do not replace or delete the original database while diagnosing the problem.
4. If a valid backup exists, use **Restore latest backup** from settings. The plugin creates another protection backup before restoration.

If a save was interrupted, the plugin automatically checks
`rss-reader.sqlite3.tmp` and `rss-reader.sqlite3.previous`, in that order, but
only after the primary database is missing or fails validation. Do not rename or
delete these files before the automatic recovery attempt. If all snapshots are
invalid, the plugin preserves them and asks you to restore from `backups/`.

Backups are stored in the selected data directory's `backups/` subdirectory.

## Moving data to another directory

When a database is already active, use **Migrate current database** to copy it to an empty target directory. Migration never overwrites an existing target database.

Use **Load target database** only when the target already contains a valid database. Do not move an open database with external filesystem tools.

## Feed updates fail

- Confirm the feed URL is a valid HTTP or HTTPS URL.
- Open the URL in a browser to check whether the source is available.
- A failed feed does not prevent successfully fetched feeds from being saved.
- Existing local papers remain readable when the network is unavailable.

## Title translation fails

Title translation uses an unofficial Google web endpoint that may be rate-limited, regionally unavailable, or changed upstream. A failure does not overwrite original titles and does not interrupt reading, feeds, recommendations, or analysis.

Disable title translation to continue using original titles.

## LLM connection testing fails

Check all three settings:

- An OpenAI-compatible HTTPS API endpoint.
- A SecretStorage entry containing the API key.
- A valid model name supported by the configured service.

The connection test requires an active database. API keys are stored in Obsidian SecretStorage and are not included in the SQLite database or backups.

## Interface language is incorrect

The plugin reads the app language during startup:

- Chinese locales display Simplified Chinese.
- English and unsupported locales use English.

After changing the app language, reload the app or disable and re-enable the plugin. The title-translation target is independent of the interface language.

## Installation and upgrades

The recommended installation method is **Settings → Community plugins → Browse**, then search for **Academic RSS Reader**, install it, and enable it.

Manual installation is a fallback. Replace only `main.js`, `manifest.json`, and `styles.css`; keep `data.json` and the user-selected Vault data directory. Never include the SQLite database in the plugin folder.
