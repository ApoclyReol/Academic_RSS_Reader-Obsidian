# Academic RSS Reader

[简体中文](README.zh-CN.md)

Academic RSS Reader is a desktop plugin for screening academic literature from RSS and Atom feeds. It stores subscriptions, reading states, translations, recommendation data, and interest analysis locally without a Python sidecar.

Version 1.3.0 adopts Obsidian's declarative settings API, adds settings-search compatibility, and requires the latest available Obsidian 1.13 release.

## Features

- Add, edit, enable, disable, and delete feeds.
- Import OPML, XML, TXT, pasted feed lists, and one-URL-per-line text.
- Update all enabled feeds automatically after the reader is first opened in a session, or update all feeds and individual feeds manually.
- Extract titles, authors, journals, years, DOIs, links, and abstracts from RSS and Atom.
- Keep stable GUIDs, normalized titles, layered deduplication, cross-feed associations, and existing reading states.
- Organize papers into unread, interested, archived, hidden, and expired baskets.
- Load papers continuously in batches of 100, open links in the system browser, and undo state changes during the current session.
- Rank unread papers with TypeScript TF-IDF and logistic regression, user-managed stopwords, and an optional OpenAI-compatible LLM review.
- Translate visible titles and analyze interests overall or by feed.
- Match the interface language to the app: Chinese locales use Simplified Chinese, while English and all other locales use English.

## Title translation

Title translation uses an unofficial, unauthenticated Google web endpoint.

- The reader can switch between original and translated titles.
- Only titles in the viewport are translated, with the next eight titles prefetched.
- Translations are cached in the local SQLite database.
- Feed updates do not wait for translation.
- Translation failures do not interrupt feeds, reading, recommendations, or analysis.
- Interface language follows Obsidian and is independent of the content translation target.
- Recommendation training stays local. It uses sparse text, author, journal, feed, and freshness features; only an explicitly requested LLM review sends paper content to the configured service.
- The keyword table supports per-term stopword/enable controls. Built-in stopwords, corpus-frequency filtering, and conservative class-neutral filtering reduce noisy terms; user-disabled terms remain disabled across model rebuilds.
- Keyword recommendations are refreshed automatically after every feed-update batch. An unchanged training hash reuses the model and scores only new or changed unread papers.
- Feed updates use ETag/Last-Modified validation, four global requests with one request per host, a 20-second scheduler timeout, Retry-After, cancellation, and automatic failure backoff.

The endpoint may be rate-limited, unavailable in some regions, or changed upstream. Translations may be inaccurate and should not be used as formal citations. Titles are sent directly from the user's device to the translation service and do not pass through a developer-operated server.

## Installation

The plugin supports desktop installations only and requires Obsidian 1.13.0 or later. Before installing or updating to v1.3.0, update Obsidian to the latest available 1.13.x release.

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

Database saves use validated temporary and previous snapshots. When the reader
loads a configured directory, a valid `rss-reader.sqlite3` is used immediately.
Only when that file is missing or invalid does the plugin try
`rss-reader.sqlite3.tmp`, then `rss-reader.sqlite3.previous`. A recovered file is
validated again before the leftover snapshots are removed. If no valid snapshot
exists, loading stops and the original files are preserved for backup recovery.

Normal database switching, restoration, and plugin shutdown wait for queued
writes to finish. If an in-memory commit cannot be saved to disk, further writes
are disabled and the reader reports that memory and disk may be inconsistent.

## Development

Node.js 18 or later is required.

```bash
npm install
npm run lint
npm test
npm run build
npm run package
```

`npm run package` uses `build/` as the only output directory. It clears the directory first, then places only `main.js`, `manifest.json`, and `styles.css` directly inside it. The project does not use separate `dist/` or `out/` directories and does not create ZIP or checksum artifacts.

Release builds are generated from version tags in GitHub Actions. The workflow attests the provenance of all three release files before publishing them. A downloaded file can be verified with:

```bash
gh attestation verify main.js -R ApoclyReol/Academic_RSS_Reader-Obsidian
```

## Documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security and privacy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [v1.3.0 release notes](docs/V1_3_0_RELEASE.md)
- [v1.2.0 release notes](docs/V1_2_0_RELEASE.md)

## License

[MIT](LICENSE)
