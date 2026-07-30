# Academic RSS Reader

[简体中文](README.zh-CN.md)

Academic RSS Reader is a desktop plugin for screening academic literature from RSS and Atom feeds. It stores subscriptions, reading states, translations, recommendation data, and interest analysis locally without a Python sidecar.

## Features

- Add, edit, enable, disable, and delete feeds.
- Import OPML, XML, TXT, pasted feed lists, and one-URL-per-line text.
- Update all enabled feeds automatically after the reader is first opened in a session, or update all feeds and individual feeds manually.
- Extract titles, authors, journals, years, DOIs, links, and abstracts from RSS and Atom.
- Keep stable GUIDs, normalized titles, layered deduplication, cross-feed associations, and existing reading states.
- Organize papers into unread, interested, archived, hidden, and expired baskets.
- Load papers continuously in batches of 100, open links in the system browser, and undo state changes during the current session.
- Rank unread papers with TypeScript TF-IDF and logistic regression, manual keywords, and an optional OpenAI-compatible LLM review.
- Translate visible titles and analyze interests overall or by feed.
- Match the interface language to the app: Chinese locales use Simplified Chinese, while English and all other locales use English.

## Title translation

Title translation uses an unofficial, unauthenticated Google web endpoint.

- The reader can switch between original and translated titles.
- Only titles in the viewport are translated, with the next eight titles prefetched.
- Translations are cached in the local SQLite database.
- Feed updates do not wait for translation.
- Translation failures do not interrupt feeds, reading, recommendations, or analysis.

The endpoint may be rate-limited, unavailable in some regions, or changed upstream. Translations may be inaccurate and should not be used as formal citations. Titles are sent directly from the user's device to the translation service and do not pass through a developer-operated server.

## Installation

The plugin supports desktop installations only and requires version 1.11.4 or later.

Academic RSS Reader is available in the community plugin directory. The recommended installation method is:

1. Open **Settings → Community plugins**.
2. Select **Browse** and search for **Academic RSS Reader**.
3. Select **Install**, then **Enable**.

### Manual installation

Manual installation is available as a fallback. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub Release and place them in:

```text
<Vault>/.obsidian/plugins/academic-rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

Reload third-party plugins and enable Academic RSS Reader.

When upgrading manually from the former `rss-reader` plugin ID, close the application, rename the old plugin directory to `academic-rss-reader`, and replace only the three release files. Keep `data.json` so the first load can move a legacy LLM API key into SecretStorage. A clean installation must select and load the existing Vault data directory again.

## Local data and backups

Before creating or loading a database, select a data directory inside the current Vault:

```text
<Vault>/<selected data directory>/
├── rss-reader.sqlite3
└── backups/
```

All runtime file operations use the Vault adapter with normalized Vault-relative paths. The plugin does not accept absolute paths or paths that traverse outside the Vault.

`data.json` stores non-sensitive settings and the SecretStorage entry name. The LLM API key is stored in SecretStorage. Subscriptions, papers, translations, recommendations, and analysis data remain in SQLite.

The settings page supports:

- Creating a new database or loading an existing database.
- Migrating the active database to an empty directory.
- Loading another valid database without overwriting it.
- Creating protection backups before dangerous operations.
- Creating manual backups and restoring the latest valid backup.

The plugin does not create a database during startup. A failed validation keeps the original file unchanged and does not create a recovery database.

## Development

Node.js 18 or later is required.

```bash
npm install
npm run lint
npm test
npm run build
npm run package
```

`npm run package` creates a three-file plugin directory, a ZIP for manual installation, and local SHA-256 checksums under `build/`. GitHub Releases intentionally contain only `main.js`, `manifest.json`, and `styles.css`, because those are the supported release assets.

Release builds are generated from version tags in GitHub Actions. The workflow attests the provenance of all three release files before publishing them. A downloaded file can be verified with:

```bash
gh attestation verify main.js -R ApoclyReol/Academic_RSS_Reader-Obsidian
```

## Documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security and privacy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [v1.1.1 release notes](docs/V1_1_1_RELEASE.md)

## License

[MIT](LICENSE)
