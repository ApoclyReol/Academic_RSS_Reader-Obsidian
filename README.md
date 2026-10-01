# Academic RSS Reader

[简体中文](README.zh-CN.md)

> **Turn scattered academic RSS feeds into a local reading queue that you can continuously screen, translate, and prioritize.**

Academic RSS Reader is a desktop Obsidian plugin for the first pass of academic literature screening. It collects RSS and Atom feeds into a local SQLite database, keeps reading decisions in five clear baskets, and learns from those decisions to prioritize papers to screen. It does not require a Python sidecar.

The plugin focuses on the step between “new papers arrived” and “I know what deserves a closer read”. It is designed to reduce repetitive triage, not to replace a reference manager or a full-text database.

> [!IMPORTANT]
> Current recommended version: **1.8.0**. This version requires Obsidian **1.13.0 or later** and is desktop-only. Its bundled runtime must also provide Node.js **22.16 or later**, `node:sqlite` `DatabaseSync`, and the SQLite Backup API. Update Obsidian before installing or updating when possible.

## Why use Academic RSS Reader

- **One reading queue**: bring journal, lab, publisher, and other RSS/Atom feeds into one reader.
- **Feedback-driven prioritization**: mark papers as following, saved, skipped, or expired, then use those decisions to rank the screening queue.
- **A small, understandable workflow**: collect, scan, classify, and return to the papers worth reading.
- **Local-first storage**: subscriptions, papers, reading states, translations, recommendations, and analysis stay in a Vault directory you choose.
- **Optional assistance**: translate visible titles or ask a configured OpenAI-compatible service to review only the papers that remain pending.
- **Recoverable and explainable**: migrations create a protection backup first; recommendation results retain positive and negative keyword evidence, while subscription defaults and article-level journal metadata stay separate.

The core principle is simple: the plugin handles repetitive collection and sorting; you decide what deserves attention.

## How it works

```text
Choose a Vault data directory
        ↓
Add or import RSS/Atom feeds
        ↓
Update feeds and collect new papers
        ↓
Scan the unread basket and mark reading states
        ↓
Refresh local recommendations
        ↓
Optionally review pending papers with an LLM
```

## Who it is for

Academic RSS Reader is a good fit if you:

- follow multiple journals, publishers, laboratories, or research topics through RSS;
- receive more new papers than you can inspect immediately;
- want a queue that reflects your own reading decisions instead of a generic popularity ranking;
- prefer to keep research data inside your local Obsidian Vault;
- want lightweight title translation without sending every paper to an AI service.

## What it can do

### Collect and organize feeds

- Add, edit, enable, disable, and delete feeds.
- Import OPML, XML, TXT, pasted feed lists, or one URL per line.
- Update enabled feeds automatically when the reader is first opened after an app launch. Feeds updated successfully within the previous hour are skipped with a visible count; manual updates always run.
- Use ETag, Last-Modified, HTTP 304, bounded concurrency, retry delays, timeouts, cancellation, health states, and automatic backoff to make repeated updates less noisy.
- Extract titles, authors, source names, years, DOIs, links, and abstracts when provided by the feed.
- Preserve stable identities, normalized titles, cross-feed associations, existing reading states, and layered duplicate checks.

### Screen papers in five baskets

- Manage papers as **To screen**, **Following**, **Saved**, **Skipped**, or **Expired**.
- Load long lists continuously in batches of 100 instead of rendering the whole database at once.
- Choose whether cards show the journal, authors, publication date, DOI, feed-provided text abstract, and graphical abstract. Titles, relevance, and actions always remain visible.
- Sort any basket by title, last-seen update time, journal, or relevance.
- Search the current basket with fuzzy keywords across titles, authors, journals, abstracts, DOI, and feed metadata.
- After following the papers you want, skip every remaining paper to screen in one confirmed action and undo the full batch when needed.
- Keep the compact basket navigation, search, translation, sorting, and status toolbar visible while scrolling; the Back to top action stays at the lower-right and returns to the list end position when you reach the bottom.
- Open the original paper in the system browser.
- Undo the most recent status action during the current reader session.

### Prioritize the screening queue

- Train a local TypeScript TF-IDF and logistic-regression model from your reading states.
- Use following and saved papers as positive examples, and skipped and expired papers as negative examples.
- Show high-relevance, pending, and low-relevance tiers using a compact status badge and two aligned lines for the strongest positive and negative keyword evidence.
- Use the same TF-IDF feature scale for training and formal scoring; cancelled background training cannot write stale results.
- Manage the learned keyword list by disabling or re-enabling individual terms.
- Refresh recommendations automatically after feed updates, while reusing an unchanged model and scoring only new or changed papers to screen when possible.
- Optionally review only pending papers with a user-configured OpenAI-compatible LLM. The LLM does not run automatically during normal feed updates.

The local model needs at least two positive and two negative training papers. Until there is enough feedback, papers can remain unscored rather than receiving an arbitrary personalized judgment.

### Translate and analyze

- Translate visible paper titles and prefetch the next eight titles while you scroll.
- Cache translations in the local database and keep the original title available at any time.
- Review overall reading states and compare interest rates across feeds.
- Interest rate is `(following + saved) / (following + saved + skipped + expired)`; papers to screen are excluded. Moving skipped papers to expired does not change the rate.
- Subscription update times and the last-update summary are parsed as UTC and displayed in the user's system timezone.
- Keep the interface language tied to Obsidian while choosing the content translation target separately. The source language is detected automatically for mixed-language feeds.
- Choose among Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), English (`en`), Japanese (`ja`), Korean (`ko`), French (`fr`), German (`de`), Spanish (`es`), Portuguese (`pt`), Italian (`it`), and Russian (`ru`) as the translation target; the settings options show each code to make the saved target explicit.

### Data model and safety boundaries

- When journal display is enabled, each card shows one journal name: an article-level value refreshed from RSS takes priority, with the earliest associated feed default used only as a fallback.
- Card settings default to the v1.5.0 presentation: journal and graphical abstract visible, with authors, publication date, DOI, and text abstract hidden.
- Cards use uniform heights by default, derived from the enabled rows. Titles reserve three lines, authors one line, and text abstracts three lines. Enable **Adjust card height to content** under **Paper cards** for compact cards with naturally wrapping titles and no empty field slots; abstracts show up to three lines and images use a bounded preview.
- Turning off graphical abstracts prevents card image elements and their remote requests from being created. Images are still loaded lazily and hidden on failure when enabled.
- Title fragments delimited by `$...$`, `$$...$$`, `\(...\)`, or `\[...\]` use Obsidian's native MathJax renderer; invalid fragments fall back to their original text.
- RSS/Atom title markup and HTML entities are converted to plain text before storage. The first database load creates a protection backup before cleaning historical titles and cached translations, while preserving translation source snapshots and hashes. Markup-only changes reuse translations; content changes invalidate cached translations and refresh them when translation is enabled.
- Corrigendum and Erratum notices remain separate papers with a correction badge, a short title, and expandable full original and translated titles. Cited original-paper years and DOIs are not inferred as correction metadata.
- Article links accept only `http:` and `https:`. RSS/XML rejects `DOCTYPE`, invalid root structures, and responses over 10 MiB; only known tracking parameters are removed, while business query parameters are preserved.
- LLM endpoints must use HTTPS, or HTTP on `localhost`, `127.0.0.1`, or `::1`. Requests have a 30-second timeout and bounded retries.

## Get started

1. Open **Settings → Community plugins → Browse**, search for **Academic RSS Reader**, and install and enable it.
2. Open **Settings → Academic RSS Reader** and choose a data directory inside the current Vault.
3. Select **Create new database** for a new setup, or **Load database** for an existing `rss-reader.sqlite3`. v1.3 and older databases are upgraded in place; a protection backup is created first and the original database is restored if migration fails.
4. Open the reader from the RSS ribbon icon, or press `Cmd/Ctrl + P` and run **Open reader**.
5. Add feeds or import an OPML/feed list, then run an update.
6. Mark papers as you review them. After you have enough examples, open **Personalized recommendations** and run **Update keyword recommendations**.
7. If you want an additional review pass, configure an OpenAI-compatible endpoint, model, and SecretStorage API key in settings, then run **Review pending items with LLM** explicitly.

If the community directory is unavailable, download only `main.js`, `manifest.json`, and `styles.css` from the matching GitHub Release and place them in:

```text
<Vault>/.obsidian/plugins/academic-rss-reader/
├── main.js
├── manifest.json
└── styles.css
```

Do not install the source-code archive generated by GitHub. When upgrading manually from the former `rss-reader` plugin ID, close Obsidian, rename the old plugin directory to `academic-rss-reader`, replace the three release files, and keep `data.json` so the legacy LLM key can be migrated to SecretStorage on first load.

## Data and privacy

Your runtime database is stored in the Vault-relative directory you select:

```text
<Vault>/<selected data directory>/
├── rss-reader.sqlite3
└── backups/
```

Subscriptions, papers, reading states, translations, recommendations, and interest analysis are stored locally in SQLite. General settings stay in the plugin's `data.json`; the LLM API key is stored through Obsidian SecretStorage, while `data.json` stores only the selected secret entry name.

Academic RSS Reader does not require an account, run telemetry, or operate a developer relay server. Network requests are limited to services you use:

- RSS/Atom updates go to the feed URLs you configure.
- Title translation uses an unofficial Google web endpoint. When enabled, visible and prefetched titles are sent directly from your device; translations may be rate-limited, inaccurate, or unavailable and should not be used for formal citation. Requests time out, retry with bounded backoff, and stop after repeated failures; a failed task remains available for manual retry.
- An LLM request is made only when you explicitly test the connection or review pending papers. The request includes the paper information needed for the review and your optional research-interest description, and is sent to the endpoint you configure.

The plugin does not create or open a database during startup. Database creation and loading begin only after you choose a Vault-relative data directory and explicitly create or load it. Saves use validated temporary and previous snapshots, and the settings page can create protection backups and restore the latest valid backup even after a persistence error is reported. The desktop-native SQLite boundary is limited to the database file, WAL/SHM sidecars, temporary files, and backups; other Vault files continue to use Obsidian's `DataAdapter` boundary.

## Compatibility and boundaries

- Desktop Obsidian only: macOS, Windows, and Linux desktop installations.
- Requires Obsidian 1.13.0 or later plus a bundled Node.js 22.16+ runtime exposing `node:sqlite`; unsupported runtimes block database loading with an upgrade prompt. There is no `sql.js` fallback.
- No Python, separate Node.js installation, or sidecar process is required; Obsidian supplies the required runtime.
- Title translation is an experimental reading aid, not a formal translation or citation service.
- The database is intended for one local desktop Obsidian instance at a time; it is not a multi-user sync database.

## Continue reading

- [Documentation index](docs/README.md)
- [Architecture design](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Security and privacy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [v1.8.0 release notes](docs/V1_8_0_RELEASE.md)
- [v1.7.1 release notes](docs/V1_7_1_RELEASE.md)
- [v1.7.0 release notes](docs/V1_7_0_RELEASE.md)
- [v1.6.3 release notes](docs/V1_6_3_RELEASE.md)
- [v1.6.2 release notes](docs/V1_6_2_RELEASE.md)
- [v1.6.1 release notes](docs/V1_6_1_RELEASE.md)
- [v1.6.0 release notes](docs/V1_6_0_RELEASE.md)
- [v1.5.0 release notes](docs/V1_5_0_RELEASE.md)
- [v1.4.1 release notes](docs/V1_4_1_RELEASE.md)
- [v1.4.0 release notes](docs/V1_4_0_RELEASE.md)
- [v1.3.0 release notes](docs/V1_3_0_RELEASE.md)
- [v1.2.0 release notes](docs/V1_2_0_RELEASE.md)

Development and release commands are documented in the [development guide](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE)
